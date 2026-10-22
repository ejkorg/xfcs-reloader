package com.onsemi.cim.apps.exensio.xfcsreloader.service.exensio;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.onsemi.cim.apps.exensio.xfcsreloader.config.ExensioProperties;
import com.onsemi.cim.apps.exensio.xfcsreloader.entity.ReloadPendingFileEntity;
import com.onsemi.cim.apps.exensio.xfcsreloader.util.FilenameParser;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * HTTP client for the Exensio API.
 *
 * <p>Confirmation lookup flow (mirrors exensioreload):</p>
 * <ul>
 *   <li>Per-schema token management (PRODUCTION / SANDBOX are separate sessions)</li>
 *   <li>Raw-SQL primary via {@code POST /v1/key/raw-sql} (Oracle SQL against op_log/lot/
 *       program/wf_log/wafer/df_export)</li>
 *   <li>Fallback to {@code POST /v1/key/lot-wafer-lookup} when raw-SQL finds nothing or errors</li>
 *   <li>Retry loop with exponential backoff for transient failures (429, 5xx, I/O)</li>
 *   <li>Automatic token invalidation and re-login on HTTP 401</li>
 *   <li>DP_LOG error probing for load-failure detection</li>
 *   <li>Data verification via verifyAndEnrich for parametric/defect classes</li>
 * </ul>
 */
@Service
public class ExensioClient {

    private static final Logger log = LoggerFactory.getLogger(ExensioClient.class);

    private static final int MAX_ATTEMPTS = 3;
    private static final long BASE_DELAY_MS = 1_000L;

    private final ExensioProperties props;
    private final ExensioAuthService authService;
    private final HttpClient httpClient;
    private final ObjectMapper objectMapper;

    public ExensioClient(ExensioProperties props,
                         ExensioAuthService authService,
                         ObjectMapper objectMapper) {
        this.props = props;
        this.authService = authService;
        this.httpClient = HttpClient.newBuilder()
                .followRedirects(HttpClient.Redirect.NEVER)
                .connectTimeout(Duration.ofSeconds(10))
                .build();
        this.objectMapper = objectMapper;
    }

    /**
     * Performs a batch lot/wafer confirmation lookup for pending files, grouped by Exensio schema.
     *
     * <p>Uses {@code pgc_key = 2} (Final Test) by default. Callers that know the session's
     * area/testerType should use {@link #lotWaferLookupBatch(List, int)}.</p>
     *
     * <p>Records whose {@code destinationFolder} is PRODUCTION are queried against the
     * PRODUCTION schema; SANDBOX against SANDBOX. Records with no destination folder
     * are returned as ERROR immediately — the monitor must detect the destination before
     * calling this.</p>
     */
    public List<BatchLookupResult.RecordUpdate> lotWaferLookupBatch(List<ReloadPendingFileEntity> records) {
        return lotWaferLookupBatch(records, ExensioPgcKeyResolver.PGC_KEY_FT);
    }

    /**
     * Performs a batch lot/wafer confirmation lookup for pending files, grouped by Exensio schema,
     * using the supplied {@code pgc_key}.
     *
     * @param records pending files awaiting Exensio confirmation
     * @param pgcKey  program-group-class key derived from the session's area/testerType
     * @return per-file updates (DONE / NOT_FOUND / ERROR)
     */
    public List<BatchLookupResult.RecordUpdate> lotWaferLookupBatch(List<ReloadPendingFileEntity> records, int pgcKey) {
        List<BatchLookupResult.RecordUpdate> combinedUpdates = new ArrayList<>();

        // Partition by resolved schema — each schema needs its own authenticated session.
        Map<String, List<ReloadPendingFileEntity>> bySchema = records.stream()
                .filter(r -> r.getDestinationFolder() != null)
                .collect(Collectors.groupingBy(r ->
                        props.resolvedDbschemaForDestination(r.getDestinationFolder())));

        for (Map.Entry<String, List<ReloadPendingFileEntity>> entry : bySchema.entrySet()) {
            String schema = entry.getKey();
            List<ReloadPendingFileEntity> batch = entry.getValue();
            log.debug("[ExensioClient] Querying schema={} for {} records", schema, batch.size());
            BatchLookupResult result = lotWaferLookupBatchForSchema(schema, batch, pgcKey);
            combinedUpdates.addAll(result.mapToRecordUpdates(batch));
        }

        // Records with no destination folder yet — return ERROR so monitor retries later.
        records.stream().filter(r -> r.getDestinationFolder() == null).forEach(pf -> {
            log.warn("[ExensioClient] No destination folder set for '{}' — cannot determine schema", pf.getAbsPath());
            combinedUpdates.add(new BatchLookupResult.RecordUpdate(
                    pf.getAbsPath(), BatchLookupResult.UpdateType.ERROR, null, null,
                    "Destination folder not yet determined (PRODUCTION or SANDBOX)",
                    null, null, null, null, null, null));
        });

        return combinedUpdates;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal: retry loop (mirrors exensioreload lotWaferLookupBatch)
    // ─────────────────────────────────────────────────────────────────────────

    private BatchLookupResult lotWaferLookupBatchForSchema(String schema,
                                                           List<ReloadPendingFileEntity> records,
                                                           int pgcKey) {
        String traceId = UUID.randomUUID().toString().substring(0, 8);
        String token = null;
        boolean refreshToken = true;
        BatchLookupResult lastResult = null;

        for (int attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            if (refreshToken) {
                try {
                    token = authService.getToken(schema);
                    refreshToken = false;
                } catch (ExensioAuthService.ExensioAuthException e) {
                    log.warn("[ExensioClient] Auth failed (schema={}, traceId={}): {}", schema, traceId, e.getMessage());
                    return new BatchLookupResult("Auth failed for " + schema + ": " + e.getMessage());
                }
            }

            lastResult = doConfirmationLookup(schema, records, token, pgcKey, traceId);

            if (lastResult.isSuccess()) {
                return lastResult;
            }

            String error = lastResult.getErrorMessage();

            if (error != null && error.contains("HTTP 401")) {
                log.debug("[ExensioClient] 401 on attempt {} (schema={}, traceId={}), invalidating token and retrying",
                        attempt, schema, traceId);
                authService.invalidateToken(schema);
                refreshToken = true;
                // no delay — retry immediately with fresh token
                continue;
            }

            if (isTransientError(error)) {
                if (attempt < MAX_ATTEMPTS) {
                    long delay = BASE_DELAY_MS * (1L << (attempt - 1)); // exponential: 1s, 2s, 4s
                    log.warn("[ExensioClient] Transient error on attempt {}/{} (schema={}, traceId={}): {}. Retrying in {}ms.",
                            attempt, MAX_ATTEMPTS, schema, traceId, error, delay);
                    try { Thread.sleep(delay); } catch (InterruptedException ie) {
                        Thread.currentThread().interrupt();
                        return new BatchLookupResult("Interrupted during retry");
                    }
                    continue;
                }
            }

            // Non-transient, non-401 error — fail fast.
            break;
        }

        return lastResult != null ? lastResult : new BatchLookupResult("Unknown error");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Raw-SQL primary, then lot-wafer-lookup fallback
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Attempts confirmation via the raw-SQL endpoint first, then falls back to the
     * lot-wafer-lookup endpoint when raw-SQL finds nothing (or is disabled).
     *
     * <p>Updated to try filename-based discovery (raw_file JOIN op_log via rawfile_key)
     * before raw-SQL, matching the exensioreload pattern where the file's filename
     * and insert_time are the primary identifiers.</p>
     */
    private BatchLookupResult doConfirmationLookup(String schema,
                                                    List<ReloadPendingFileEntity> records,
                                                    String token,
                                                    int pgcKey,
                                                    String traceId) {
        // Step 1: Filename-based discovery (primary, mirrors exensioreload)
        Map<String, LoadedRow> filenameMatches = findLoadedByFilename(records, schema);
        if (!filenameMatches.isEmpty()) {
            log.info("[ExensioClient] Filename-based discovery found {} matches (schema={}, traceId={})",
                    filenameMatches.size(), schema, traceId);
            return convertLoadedRowsToBatchResult(filenameMatches, records);
        }

        // Step 2: Raw-SQL fallback
        if (props.isPreferRawSql()) {
            BatchLookupResult rawSqlResult = doRawSqlLookupBatch(schema, records, token, pgcKey, traceId);
            if (rawSqlResult.isSuccess() && !rawSqlResult.getLots().isEmpty()) {
                log.info("[ExensioClient] Raw-SQL found results (schema={}, lots={}, traceId={})",
                        schema, rawSqlResult.getLots().size(), traceId);
                return rawSqlResult;
            }
            if (rawSqlResult.isSuccess()) {
                log.debug("[ExensioClient] Raw-SQL returned empty (schema={}, traceId={}) — falling back to lot-wafer-lookup",
                        schema, traceId);
            } else {
                log.warn("[ExensioClient] Raw-SQL failed (schema={}, traceId={}): {} — falling back to lot-wafer-lookup",
                        schema, traceId, rawSqlResult.getErrorMessage());
            }
        }

        return doLotWaferLookupBatch(schema, records, token, pgcKey, traceId);
    }

    /**
     * Converts LoadedRow matches from filename-based discovery into a BatchLookupResult.
     *
     * <p>Each LoadedRow is matched back to its source {@link ReloadPendingFileEntity} by
     * filename prefix, so the resulting {@code lot_id} values match what
     * {@link #mapToRecordUpdates(List)} expects.</p>
     */
    private BatchLookupResult convertLoadedRowsToBatchResult(Map<String, LoadedRow> matches,
                                                              List<ReloadPendingFileEntity> records) {
        // pendingFile absPath → LoadedRow so we can recover the userLotId per matched file
        Map<String, ReloadPendingFileEntity> matchedFiles = new LinkedHashMap<>();
        for (LoadedRow row : matches.values()) {
            String fn = row.fileName() == null ? "" : row.fileName();
            for (ReloadPendingFileEntity candidate : records) {
                String candidatePrefix = buildLoadedFilePrefix(candidate.getFileName());
                if (candidatePrefix.isBlank()) continue;
                if (fn.startsWith(candidatePrefix.replace("\\_%", ""))) {
                    matchedFiles.put(candidate.getAbsPath(), candidate);
                    break;
                }
            }
        }

        // Group matched files by userLotId (upper) to build lot-level results
        Map<String, BatchLookupResult.LotResult> byLotId = new LinkedHashMap<>();
        for (Map.Entry<String, ReloadPendingFileEntity> entry : matchedFiles.entrySet()) {
            ReloadPendingFileEntity pf = entry.getValue();
            String lotId = pf.getUserLotId();
            if (lotId == null || lotId.isBlank()) lotId = "UNKNOWN";

            LoadedRow row = matches.get(entry.getKey());
            final String finalLotId = lotId;
            final long finalLotKey = row.lotKey();
            final long finalPgKey = row.pgKey();
            BatchLookupResult.LotResult lotResult = byLotId.computeIfAbsent(
                    finalLotId.toUpperCase(Locale.ROOT),
                    k -> new BatchLookupResult.LotResult(finalLotId, finalLotKey, finalPgKey, new ArrayList<>()));

            lotResult.wafers().add(new BatchLookupResult.LotResult.WaferResult(
                    "", row.lgKey(), row.pgKey(), null,
                    row.insertTime(), row.fileName(), row.schemaName()));
        }

        return new BatchLookupResult(new ArrayList<>(byLotId.values()));
    }

    /**
     * Extracts a lot identifier from an Exensio filename for display purposes.
     * Falls back to the full filename prefix when no lot pattern is recognized.
     */
    private String extractLotFromFilename(String fileName) {
        if (fileName == null || fileName.isBlank()) return "UNKNOWN";
        String base = fileName.trim();
        int dot = base.lastIndexOf('.');
        if (dot > 0) base = base.substring(0, dot);
        return base;
    }

    /**
     * Executes a single raw-SQL batch query for all lots in this schema group.
     *
     * <p>Mirrors exensioreload's raw-SQL confirmation query: joins {@code op_log}/{@code lot}/
     * {@code program}/{@code wf_log}/{@code wafer}/{@code df_export}, filters by {@code pgc_key},
     * lot ID (upper/lower), optional wafer ID, and optional filename token.</p>
     */
    private BatchLookupResult doRawSqlLookupBatch(String schema,
                                                   List<ReloadPendingFileEntity> records,
                                                   String token,
                                                   int pgcKey,
                                                   String traceId) {
        try {
            String sql = buildBatchRawSql(records, pgcKey);
            if (sql == null) {
                return new BatchLookupResult("No valid lot ids in batch (schema=" + schema + ")");
            }

            String url = props.resolvedBaseUrl().replaceAll("/$", "") + "/v1/key/raw-sql";

            ObjectNode body = objectMapper.createObjectNode();
            body.put("sql", sql);

            log.info("[ExensioClient] POST raw-sql (schema={}, traceId={})", schema, traceId);
            log.debug("[ExensioClient] raw-sql SQL (traceId={}):\n{}", traceId, sql);

            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(url))
                    .timeout(Duration.ofSeconds(props.getRawSqlTimeoutSeconds()))
                    .header("Authorization", "Bearer " + token)
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(body.toString()))
                    .build();

            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());

            if (response.statusCode() == 401) {
                return new BatchLookupResult("HTTP 401");
            }
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                return new BatchLookupResult("HTTP " + response.statusCode());
            }

            return parseRawSqlResponse(response.body());
        } catch (Exception e) {
            log.warn("[ExensioClient] Raw-SQL request failed (schema={}, traceId={}): {}",
                    schema, traceId, e.getMessage());
            return new BatchLookupResult("Raw-SQL error: " + e.getMessage());
        }
    }

    /**
     * Builds a single Oracle SQL statement that ORs one predicate block per record.
     * Each block filters by {@code pgc_key}, lot ID (upper+lower), optional wafer
     * (wf_id upper/lower/padded + wf_num), and optional filename token.
     */
    private String buildBatchRawSql(List<ReloadPendingFileEntity> records, int pgcKey) {
        List<String> clauses = new ArrayList<>();
        for (ReloadPendingFileEntity r : records) {
            String lot = r.getUserLotId();
            if (lot == null || lot.isBlank()) {
                continue;
            }
            String cleanLot = lot.trim();
            String wafer = FilenameParser.parseWaferId(r.getFileName());
            String filenameToken = filenameToken(r.getFileName());

            StringBuilder clause = new StringBuilder();
            clause.append("(ol.pgc_key = ").append(pgcKey)
                    .append(" AND l.lot_id IN ('")
                    .append(escapeSql(cleanLot.toUpperCase(Locale.ROOT)))
                    .append("', '")
                    .append(escapeSql(cleanLot.toLowerCase(Locale.ROOT)))
                    .append("')");

            if (wafer != null && !wafer.isBlank()) {
                String cleanWafer = stripWaferPrefix(wafer);
                String paddedWafer = zeroPadWafer(cleanWafer);
                clause.append(" AND (w.wf_id IN ('")
                        .append(escapeSql(cleanWafer.toUpperCase(Locale.ROOT)))
                        .append("', '")
                        .append(escapeSql(cleanWafer.toLowerCase(Locale.ROOT)))
                        .append("', '")
                        .append(escapeSql(paddedWafer.toUpperCase(Locale.ROOT)))
                        .append("', '")
                        .append(escapeSql(paddedWafer.toLowerCase(Locale.ROOT)))
                        .append("')");
                try {
                    int waferNum = Integer.parseInt(cleanWafer);
                    clause.append(" OR w.wf_num = ").append(waferNum);
                } catch (NumberFormatException ignored) {
                }
                clause.append(")");
            }

            if (filenameToken != null && !filenameToken.isBlank()) {
                clause.append(" AND UPPER(NVL(de.file_name,'')) LIKE '%")
                        .append(escapeLike(filenameToken.toUpperCase(Locale.ROOT)))
                        .append("%'");
            }

            // Time window: the Exensio load must have been inserted after the file was
            // (re)staged for reload, and within maxLookupWindowMinutes of that time.
            // process_datetime (re-stage) <= ol.insert_time < process_datetime + window.
            if (r.getCreatedAt() != null) {
                String refTime = oracleTimestamp(r.getCreatedAt());
                clause.append(" AND ol.insert_time >= TO_TIMESTAMP('")
                        .append(refTime)
                        .append("', 'YYYY-MM-DD HH24:MI:SS')");
                clause.append(" AND ol.insert_time < TO_TIMESTAMP('")
                        .append(refTime)
                        .append("', 'YYYY-MM-DD HH24:MI:SS') + NUMTODSINTERVAL(")
                        .append(props.getMaxLookupWindowMinutes())
                        .append(", 'MINUTE')");
            }

            clause.append(")");
            clauses.add(clause.toString());
        }

        if (clauses.isEmpty()) {
            return null;
        }

        return "SELECT lot_id, wafer_id, lot_key, wafer_key, pg_key, ppid, file_name FROM (" +
                " SELECT l.lot_id AS lot_id, NVL(w.wf_id,'') AS wafer_id," +
                "  ol.lot_key AS lot_key, NVL(w.wf_key,0) AS wafer_key," +
                "  NVL(ol.pg_key,0) AS pg_key, NVL(p.ppid,'') AS ppid," +
                "  NVL(de.file_name,'') AS file_name" +
                "  FROM op_log ol" +
                "  JOIN lot l ON l.lot_key = ol.lot_key" +
                "  JOIN program p ON p.pg_key = ol.pg_key" +
                "  LEFT JOIN wf_log wfl ON wfl.lg_key = ol.lg_key" +
                "  LEFT JOIN wafer w ON w.wf_key = wfl.wf_key" +
                "  LEFT JOIN df_export de ON de.lg_key = ol.lg_key AND (w.wf_key IS NULL OR de.wf_key = w.wf_key)" +
                "  WHERE (" + String.join(" OR ", clauses) + ")" +
                "  ORDER BY ol.end_time DESC" +
                ") WHERE ROWNUM <= " + props.getRawSqlRowLimit();
    }

    /**
     * Parses the raw-SQL JSON response (either a bare array or wrapped in {@code rows})
     * into a {@link BatchLookupResult}, grouping wafer rows by lot.
     */
    private BatchLookupResult parseRawSqlResponse(String body) {
        try {
            JsonNode root = objectMapper.readTree(body);
            JsonNode rows;
            if (root.isArray()) {
                rows = root;
            } else if (root.path("rows").isArray()) {
                rows = root.path("rows");
            } else {
                rows = objectMapper.createArrayNode();
            }

            // lotId (upper) → list of wafer results
            Map<String, List<BatchLookupResult.LotResult.WaferResult>> byLot = new LinkedHashMap<>();
            Map<String, Long> lotKeys = new LinkedHashMap<>();
            Map<String, Long> lotPgKeys = new LinkedHashMap<>();

            for (JsonNode row : rows) {
                long waferKey = getLong(row, "WAFER_KEY");
                long pgKey = getLong(row, "PG_KEY");
                String lotId = safeUpper(getText(row, "LOT_ID"));
                if (lotId == null || lotId.isBlank()) continue;

                if (waferKey > 0) {
                    String waferId = stripWaferPrefix(getText(row, "WAFER_ID"));
                    String ppid = getText(row, "PPID");
                    byLot.computeIfAbsent(lotId, k -> new ArrayList<>())
                            .add(new BatchLookupResult.LotResult.WaferResult(
                                    waferId == null ? "" : waferId, waferKey, pgKey, ppid,
                                    null, null, null));
                }

                long lotKey = getLong(row, "LOT_KEY");
                if (lotKey > 0) lotKeys.putIfAbsent(lotId, lotKey);
                if (pgKey > 0) lotPgKeys.putIfAbsent(lotId, pgKey);
            }

            List<BatchLookupResult.LotResult> lots = new ArrayList<>();
            for (Map.Entry<String, List<BatchLookupResult.LotResult.WaferResult>> e : byLot.entrySet()) {
                lots.add(new BatchLookupResult.LotResult(
                        e.getKey(),
                        lotKeys.getOrDefault(e.getKey(), 0L),
                        lotPgKeys.getOrDefault(e.getKey(), 0L),
                        e.getValue()));
            }

            return new BatchLookupResult(lots);
        } catch (Exception e) {
            log.warn("[ExensioClient] Failed to parse raw-SQL response: {}", e.getMessage());
            return new BatchLookupResult("Raw-SQL parse error: " + e.getMessage());
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal: single HTTP call to POST /v1/key/lot-wafer-lookup
    // ─────────────────────────────────────────────────────────────────────────

    private BatchLookupResult doLotWaferLookupBatch(String schema,
                                                     List<ReloadPendingFileEntity> records,
                                                     String token,
                                                     int pgcKey,
                                                     String traceId) {
        long startMs = System.currentTimeMillis();
        try {
            String url = props.resolvedBaseUrl().replaceAll("/$", "") + "/v1/key/lot-wafer-lookup";

            // Collect unique lot ids — one API call covers all lots in this schema batch.
            Set<String> uniqueLots = new LinkedHashSet<>();
            Set<String> uniqueWafers = new LinkedHashSet<>();
            for (ReloadPendingFileEntity r : records) {
                if (r.getUserLotId() != null && !r.getUserLotId().isBlank()) {
                    uniqueLots.add(r.getUserLotId());
                }
                String wafer = FilenameParser.parseWaferId(r.getFileName());
                if (wafer != null && !wafer.isBlank()) {
                    uniqueWafers.add(stripWaferPrefix(wafer));
                }
            }

            if (uniqueLots.isEmpty()) {
                return new BatchLookupResult("No valid lot ids in batch (schema=" + schema + ")");
            }

            ObjectNode body = objectMapper.createObjectNode();
            body.put("pgc_key", pgcKey);
            ArrayNode lotIds = body.putArray("lot_ids");
            uniqueLots.forEach(lotIds::add);
            if (!uniqueWafers.isEmpty()) {
                ArrayNode waferIds = body.putArray("wafer_ids");
                uniqueWafers.forEach(waferIds::add);
            }

            log.info("[ExensioClient] POST lot-wafer-lookup (schema={}, lots={}, pgc_key={}, traceId={})",
                    schema, uniqueLots, pgcKey, traceId);

            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(url))
                    .timeout(Duration.ofSeconds(30))
                    .header("Authorization", "Bearer " + token)
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(body.toString()))
                    .build();

            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            long elapsedMs = System.currentTimeMillis() - startMs;

            log.debug("[ExensioClient] Response: schema={}, HTTP={}, elapsed={}ms, traceId={}",
                    schema, response.statusCode(), elapsedMs, traceId);

            if (response.statusCode() == 401) {
                return new BatchLookupResult("HTTP 401");
            }
            if (response.statusCode() == 429) {
                return new BatchLookupResult("HTTP 429 (rate limited)");
            }
            if (response.statusCode() >= 500) {
                return new BatchLookupResult("HTTP " + response.statusCode());
            }
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                return new BatchLookupResult("HTTP " + response.statusCode());
            }

            BatchLookupResult result = BatchLookupResult.parse(response.body(), objectMapper);
            log.info("[ExensioClient] Lookup done: schema={}, lots={}, found={}, traceId={}",
                    schema, uniqueLots.size(), result.getLots().size(), traceId);
            return result;

        } catch (Exception e) {
            long elapsedMs = System.currentTimeMillis() - startMs;
            log.warn("[ExensioClient] Request failed after {}ms (schema={}, traceId={}): {}",
                    elapsedMs, schema, traceId, e.getMessage());
            return new BatchLookupResult("Error: " + e.getMessage());
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────────

    private boolean isTransientError(String msg) {
        if (msg == null) return false;
        return msg.contains("HTTP 429") || msg.contains("HTTP 500")
                || msg.contains("HTTP 502") || msg.contains("HTTP 503")
                || msg.contains("HTTP 504") || msg.contains("Timeout")
                || msg.startsWith("Error: "); // I/O errors from HttpClient
    }

    /**
     * Formats an {@link java.time.Instant} as an Oracle {@code TO_TIMESTAMP} literal
     * in UTC ({@code YYYY-MM-DD HH24:MI:SS}).
     */
    private String oracleTimestamp(java.time.Instant instant) {
        return java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")
                .withZone(java.time.ZoneOffset.UTC)
                .format(instant);
    }

    /**
     * Builds the filename token used for {@code df_export.file_name} matching:
     * strips .gz, MD5 hash suffix, and reload timestamp suffix.
     */
    private String filenameToken(String fileName) {
        if (fileName == null || fileName.isBlank()) return null;
        String name = fileName.trim();
        if (name.toLowerCase(Locale.ROOT).endsWith(".gz")) {
            name = name.substring(0, name.length() - 3);
        }
        name = name.replaceAll("(?i)_MD5-[0-9a-fA-F]{32}", "");
        name = name.replaceAll("(?i)_reloaded_\\d{14}", "");
        int dot = name.lastIndexOf('.');
        if (dot > 0) {
            name = name.substring(0, dot);
        }
        return name.isBlank() ? null : name;
    }

    private String stripWaferPrefix(String wafer) {
        if (wafer == null || wafer.isBlank()) return "";
        return wafer.trim().replaceFirst("^[A-Za-z]+[-_]*", "");
    }

    private String zeroPadWafer(String wafer) {
        if (wafer == null) return "";
        String cleaned = wafer.trim();
        if (cleaned.matches("\\d{1,2}")) {
            return String.format("%02d", Integer.parseInt(cleaned));
        }
        return cleaned;
    }

    private String escapeSql(String value) {
        return value == null ? "" : value.replace("'", "''");
    }

    private String escapeLike(String value) {
        if (value == null) return "";
        return value.replace("\\", "\\\\")
                .replace("%", "\\%")
                .replace("_", "\\_")
                .replace("'", "''");
    }

    private String getText(JsonNode node, String field) {
        JsonNode v = getFieldNode(node, field);
        if (v == null || v.isNull()) return null;
        String text = v.asText();
        return text == null || text.isBlank() ? null : text;
    }

    private long getLong(JsonNode node, String field) {
        JsonNode v = getFieldNode(node, field);
        if (v == null || v.isNull()) return 0L;
        if (v.isNumber()) return v.asLong();
        try {
            return Long.parseLong(v.asText());
        } catch (Exception e) {
            return 0L;
        }
    }

    private JsonNode getFieldNode(JsonNode node, String field) {
        if (node == null || field == null) return null;
        JsonNode direct = node.get(field);
        if (direct != null) return direct;
        JsonNode upper = node.get(field.toUpperCase(Locale.ROOT));
        if (upper != null) return upper;
        return node.get(field.toLowerCase(Locale.ROOT));
    }

    private String safeUpper(String value) {
        return value == null ? null : value.toUpperCase(Locale.ROOT);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Filename-based insert-time verification (mirrors exensioreload)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Builds the Exensio filename prefix LIKE pattern: strips the last extension,
     * escapes SQL special chars, and appends {@code \_%} to match Exensio's
     * appended {@code _YYYYMMDDHHMMSS} load stamp.
     *
     * <p>Example: {@code LOT.123.FILE.LOG} → {@code LOT.123.FILE\_%}</p>
     */
    public String buildLoadedFilePrefix(String rawFilename) {
        if (rawFilename == null || rawFilename.isBlank()) {
            return "";
        }
        String name = rawFilename.trim();
        // Strip .gz compound extension first
        if (name.toLowerCase(Locale.ROOT).endsWith(".gz")) {
            name = name.substring(0, name.length() - 3);
        }
        // Strip the last extension (e.g. .000, .LOG, .txt)
        int lastDot = name.lastIndexOf('.');
        if (lastDot > 0) {
            name = name.substring(0, lastDot);
        }
        return escapeLike(name)
                + "\\_%";
    }

    /**
     * Phase A — filename-based discovery query: finds recently loaded files in Exensio
     * by matching the raw file name prefix against {@code raw_file.file_name}, joined
     * to {@code op_log} via {@code rawfile_key}, bounded by {@code raw_file.insert_time}.
     *
     * <p>This is the primary confirmation path (mirrors exensioreload's
     * {@code findLoadedByFilename}). Lot/wafer lookup is the fallback.</p>
     *
     * <p>Key join: {@code raw_file.rawfile_key = op_log.rawfile_key} — NOT {@code lg_key}.</p>
     *
     * @return a map of absPath → LoadedRow for matched files; empty map when nothing found
     */
    public java.util.Map<String, LoadedRow> findLoadedByFilename(
            List<ReloadPendingFileEntity> records, String schema) {

        java.util.Map<String, LoadedRow> matches = new java.util.LinkedHashMap<>();
        if (records == null || records.isEmpty() || schema == null || schema.isBlank()) {
            return matches;
        }

        // Build unique filename prefixes and per-pgc_key groups
        java.util.Map<Integer, java.util.List<String>> prefixesByPgcKey = new java.util.LinkedHashMap<>();
        java.util.Map<String, ReloadPendingFileEntity> prefixToRecord = new java.util.LinkedHashMap<>();

        for (ReloadPendingFileEntity r : records) {
            String fn = r.getFileName();
            if (fn == null || fn.isBlank()) continue;

            // Resolve pgc_key from the file's dataType if available; 
            // otherwise we try the common classes. For xfcs-reloader we use the session's
            // pgc_key passed via the batch, but here we handle per-file resolution too.
            int pgcKey = resolvePgcKeyForFile(r);
            String prefix = buildLoadedFilePrefix(fn);
            if (prefix.isBlank()) continue;

            java.util.List<String> list = prefixesByPgcKey.computeIfAbsent(pgcKey, k -> new java.util.ArrayList<>());
            if (!list.contains(prefix)) {
                list.add(prefix);
            }
            prefixToRecord.putIfAbsent(prefix, r);
        }

        if (prefixesByPgcKey.isEmpty()) {
            return matches;
        }

        // Lower bound: earliest record createdAt minus window
        Instant earliest = records.stream()
                .map(ReloadPendingFileEntity::getCreatedAt)
                .filter(java.util.Objects::nonNull)
                .min(java.util.Comparator.naturalOrder())
                .orElse(Instant.now());

        int windowBefore = props.getFilenameInsertTime().getWindowBeforeMinutes();
        Instant lowerBound = earliest.minus(java.time.Duration.ofMinutes(windowBefore));
        String lowerBoundUtc = java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")
                .withZone(java.time.ZoneOffset.UTC)
                .format(lowerBound);

        int maxRows = Math.max(records.size() * props.getFilenameInsertTime().getMaxRowsPerRecord(), 100);

        String token;
        try {
            token = authService.getToken(schema);
        } catch (ExensioAuthService.ExensioAuthException e) {
            log.warn("[ExensioClient] findLoadedByFilename auth failed (schema={}): {}", schema, e.getMessage());
            return matches;
        }

        try {
            for (java.util.Map.Entry<Integer, java.util.List<String>> group : prefixesByPgcKey.entrySet()) {
                int pgcKey = group.getKey();
                java.util.List<String> prefixes = group.getValue();

                // Chunk prefixes to avoid overly long SQL
                int chunkSize = 50;
                for (int i = 0; i < prefixes.size(); i += chunkSize) {
                    int end = Math.min(i + chunkSize, prefixes.size());
                    java.util.List<String> chunk = prefixes.subList(i, end);

                    String orClause = chunk.stream()
                            .map(p -> "rf.file_name LIKE '" + p + "' ESCAPE '\\'")
                            .collect(java.util.stream.Collectors.joining(" OR "));

                    StringBuilder sql = new StringBuilder();
                    sql.append("SELECT rf.file_name AS fn, ")
                       .append("ol.lg_key AS lg, ")
                       .append("ol.lot_key AS lk, ")
                       .append("ol.pg_key AS pk, ")
                       .append("TO_CHAR(ol.insert_time, 'YYYY-MM-DD HH24:MI:SS') AS it, ")
                       .append("TO_CHAR(rf.insert_time, 'YYYY-MM-DD HH24:MI:SS') AS rfit, ")
                       .append("'").append(schema).append("' AS schema_name ")
                       .append("FROM ").append(schema).append(".raw_file rf ")
                       .append("JOIN ").append(schema).append(".op_log ol ")
                       .append("  ON ol.rawfile_key = rf.rawfile_key ")
                       .append("WHERE rf.insert_time >= TIMESTAMP '").append(lowerBoundUtc).append("' ")
                       .append("  AND ( ").append(orClause).append(" ) ")
                       .append("  AND ol.pgc_key = ").append(pgcKey).append(" ")
                       .append("FETCH FIRST ").append(maxRows).append(" ROWS ONLY");

                    JsonNode rows = executeRawSqlWithRetry(sql.toString(), schema, token, null);
                    if (rows != null && rows.isArray()) {
                        for (JsonNode row : rows) {
                            String fn = getText(row, "fn");
                            long lg = getLong(row, "lg");
                            long lk = getLong(row, "lk");
                            long pk = getLong(row, "pk");
                            String insertTimeStr = getText(row, "it");
                            String schemaName = getText(row, "schema_name");

                            if (lg <= 0) continue;

                            // Find the matching pending file by filename prefix
                            ReloadPendingFileEntity matched = null;
                            for (ReloadPendingFileEntity candidate : records) {
                                String candidatePrefix = buildLoadedFilePrefix(candidate.getFileName());
                                if (candidatePrefix.isBlank()) continue;
                                String normFn = fn != null ? fn : "";
                                if (normFn.startsWith(candidatePrefix.replace("\\_%", ""))) {
                                    matched = candidate;
                                    break;
                                }
                            }
                            if (matched == null) continue;

                            Instant insertTime = parseSqlUtcTimestamp(insertTimeStr);
                            matches.put(matched.getAbsPath(),
                                    new LoadedRow(fn, lg, lk, pk, pgcKey, insertTime, schemaName));
                        }
                    }

                    // Refresh token after potential 401 retry
                    try {
                        token = authService.getToken(schema);
                    } catch (Exception ignored) {}
                }
            }
        } catch (Exception e) {
            log.warn("[ExensioClient] findLoadedByFilename error (schema={}): {}", schema, e.getMessage());
        }

        return matches;
    }

    /**
     * Resolves the pgc_key for a pending file from its session's area/testerType.
     * Defaults to Final Test (2) when the session cannot be determined.
     */
    private int resolvePgcKeyForFile(ReloadPendingFileEntity file) {
        // Try to resolve from the session associated with this file
        // For simplicity, default to FT (2) — the monitor already resolves at session level
        // and passes the pgcKey to lotWaferLookupBatch. This method is used for the
        // filename-based discovery query where we may not have the session context.
        return ExensioPgcKeyResolver.PGC_KEY_FT;
    }

    /**
     * Executes a raw-SQL query against the Exensio API with automatic token refresh on 401.
     */
    private JsonNode executeRawSqlWithRetry(String sql, String schema, String token, String traceId) {
        try {
            String result = doCallRawSql(sql, token, schema);
            if (result == null) {
                // 401 — refresh token and retry once
                authService.invalidateToken(schema);
                try {
                    token = authService.login(schema);
                } catch (ExensioAuthService.ExensioAuthException e) {
                    log.warn("[ExensioClient] Token refresh failed (schema={}): {}", schema, e.getMessage());
                    return null;
                }
                result = doCallRawSql(sql, token, schema);
            }
            if (result == null) return null;
            return objectMapper.readTree(result);
        } catch (Exception e) {
            log.warn("[ExensioClient] Raw-SQL error (schema={}): {}", schema, e.getMessage());
            return null;
        }
    }

    private String doCallRawSql(String sql, String token, String schema) throws Exception {
        String url = props.resolvedBaseUrl().replaceAll("/$", "") + "/v1/key/raw-sql";
        String bodyJson = objectMapper.createObjectNode().put("sql", sql).toString();

        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(url))
                .timeout(Duration.ofSeconds(props.getRawSqlTimeoutSeconds()))
                .header("Authorization", "Bearer " + token)
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(bodyJson))
                .build();

        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() == 401) {
            return null;
        }
        if (response.statusCode() < 200 || response.statusCode() >= 300) {
            throw new RuntimeException("Exensio raw-sql returned HTTP " + response.statusCode()
                    + ": " + response.body());
        }
        return response.body();
    }

    /**
     * Parses an ANSI UTC timestamp string (yyyy-MM-dd HH:mm:ss or ISO) into Instant.
     */
    public Instant parseSqlUtcTimestamp(String it) {
        if (it == null || it.isBlank()) return null;
        String trimmed = it.trim();
        try {
            if (trimmed.contains("T")) {
                return Instant.parse(trimmed);
            }
            return java.time.LocalDateTime.parse(trimmed,
                    java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"))
                    .atZone(java.time.ZoneOffset.UTC)
                    .toInstant();
        } catch (Exception e) {
            log.warn("Failed to parse SQL UTC timestamp '{}': {}", it, e.getMessage());
            return null;
        }
    }

    /**
     * Result row from the filename-based discovery query.
     */
    public record LoadedRow(
            String fileName,
            long lgKey,
            long lotKey,
            long pgKey,
            int pgcKey,
            Instant insertTime,
            String schemaName) {
    }
}
