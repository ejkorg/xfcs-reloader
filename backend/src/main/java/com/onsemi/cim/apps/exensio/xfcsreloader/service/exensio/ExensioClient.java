package com.onsemi.cim.apps.exensio.xfcsreloader.service.exensio;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.onsemi.cim.apps.exensio.xfcsreloader.config.ExensioProperties;
import com.onsemi.cim.apps.exensio.xfcsreloader.entity.ReloadPendingFileEntity;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * HTTP client for the Exensio API.
 *
 * <p>Mirrors the pattern from exensioreload's ExensioClient:</p>
 * <ul>
 *   <li>Per-schema token management (PRODUCTION / SANDBOX are separate sessions)</li>
 *   <li>Retry loop with exponential backoff for transient failures (429, 5xx, I/O)</li>
 *   <li>Automatic token invalidation and re-login on HTTP 401</li>
 *   <li>Endpoint: {@code POST /v1/key/lot-wafer-lookup}</li>
 * </ul>
 *
 * <p>Unlike exensioreload, this client does NOT use the raw-sql endpoint because
 * xfcs-reloader has no ElasticSearch / CPLog pipeline — the lot id is sufficient.</p>
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
                .connectTimeout(Duration.ofSeconds(10))
                .build();
        this.objectMapper = objectMapper;
    }

    /**
     * Performs a batch lot-wafer lookup for all pending files, grouped by Exensio schema.
     *
     * <p>Records whose {@code destinationFolder} is PRODUCTION are queried against the
     * PRODUCTION schema; SANDBOX against SANDBOX. Records with no destination folder
     * are returned as ERROR immediately — the monitor must detect the destination before
     * calling this.</p>
     */
    public List<BatchLookupResult.RecordUpdate> lotWaferLookupBatch(List<ReloadPendingFileEntity> records) {
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
            BatchLookupResult result = lotWaferLookupBatchForSchema(schema, batch);
            combinedUpdates.addAll(result.mapToRecordUpdates(batch));
        }

        // Records with no destination folder yet — return ERROR so monitor retries later.
        records.stream().filter(r -> r.getDestinationFolder() == null).forEach(pf -> {
            log.warn("[ExensioClient] No destination folder set for '{}' — cannot determine schema", pf.getAbsPath());
            combinedUpdates.add(new BatchLookupResult.RecordUpdate(
                    pf.getAbsPath(), BatchLookupResult.UpdateType.ERROR, null, null,
                    "Destination folder not yet determined (PRODUCTION or SANDBOX)"));
        });

        return combinedUpdates;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal: retry loop (mirrors exensioreload lotWaferLookupBatch)
    // ─────────────────────────────────────────────────────────────────────────

    private BatchLookupResult lotWaferLookupBatchForSchema(String schema,
                                                           List<ReloadPendingFileEntity> records) {
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

            lastResult = doLotWaferLookupBatch(schema, records, token, traceId);

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
    // Internal: single HTTP call to POST /v1/key/lot-wafer-lookup
    // ─────────────────────────────────────────────────────────────────────────

    private BatchLookupResult doLotWaferLookupBatch(String schema,
                                                     List<ReloadPendingFileEntity> records,
                                                     String token, String traceId) {
        long startMs = System.currentTimeMillis();
        try {
            String url = props.resolvedBaseUrl().replaceAll("/$", "") + "/v1/key/lot-wafer-lookup";

            // Collect unique lot ids — one API call covers all lots in this schema batch.
            Set<String> uniqueLots = new LinkedHashSet<>();
            for (ReloadPendingFileEntity r : records) {
                if (r.getUserLotId() != null && !r.getUserLotId().isBlank()) {
                    uniqueLots.add(r.getUserLotId());
                }
            }

            if (uniqueLots.isEmpty()) {
                return new BatchLookupResult("No valid lot ids in batch (schema=" + schema + ")");
            }

            ObjectNode body = objectMapper.createObjectNode();
            body.put("pgc_key", 1);
            ArrayNode lotIds = body.putArray("lot_ids");
            uniqueLots.forEach(lotIds::add);

            log.info("[ExensioClient] POST lot-wafer-lookup (schema={}, lots={}, traceId={})",
                    schema, uniqueLots, traceId);

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
}
