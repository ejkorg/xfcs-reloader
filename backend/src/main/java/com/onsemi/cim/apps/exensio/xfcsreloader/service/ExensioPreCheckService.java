package com.onsemi.cim.apps.exensio.xfcsreloader.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.onsemi.cim.apps.exensio.xfcsreloader.config.ExensioProperties;
import com.onsemi.cim.apps.exensio.xfcsreloader.service.exensio.ExensioAuthService;
import com.onsemi.cim.apps.exensio.xfcsreloader.web.dto.ExensioPreCheckRequest;
import com.onsemi.cim.apps.exensio.xfcsreloader.web.dto.ExensioPreCheckResponse;
import com.onsemi.cim.apps.exensio.xfcsreloader.web.dto.ExensioPreCheckRow;
import com.onsemi.cim.apps.exensio.xfcsreloader.web.dto.PreCheckBlock;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.sql.DataSource;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Queries Snowflake (primary) or the Exensio raw-SQL endpoint (fallback) to determine
 * whether submitted lots already exist in Exensio within the given year/month range.
 *
 * <p>Primary path: Snowflake JDBC via {@code snowflakeDataSource}, querying
 * {@code ANALYTICSPRD.MFG.EXENSIO_PROD_OPLOG_METADATA}.</p>
 * <p>Fallback path: Exensio HTTP {@code POST /v1/key/raw-sql} (Oracle SQL).</p>
 */
@Service
public class ExensioPreCheckService {

    private static final Logger log = LoggerFactory.getLogger(ExensioPreCheckService.class);

    // ── Snowflake SQL: with INSERT_TIME lower-bound date filter ────────────────
    static final String LOT_CHECK_SQL_WITH_DATE = """
            WITH provided_lots AS (
                SELECT value::VARCHAR AS lot_id
                FROM TABLE(FLATTEN(PARSE_JSON(?)))
            ),
            found_lots AS (
                SELECT DISTINCT LOT_ID, SCHEMANAME
                FROM ANALYTICSPRD.MFG.EXENSIO_PROD_OPLOG_METADATA
                WHERE PGC_KEY     = 2
                  AND INSERT_TIME >= TO_DATE(? || '-01', 'YYYY-MM-DD')
                  AND LOT_ID IN (SELECT lot_id FROM provided_lots)
            ),
            ranked AS (
                SELECT LOT_ID, SCHEMANAME,
                       ROW_NUMBER() OVER (
                           PARTITION BY LOT_ID
                           ORDER BY CASE WHEN UPPER(SCHEMANAME) LIKE '%PROD%' THEN 0 ELSE 1 END
                       ) AS rn
                FROM found_lots
            )
            SELECT p.lot_id, COALESCE(r.SCHEMANAME, 'NOT FOUND') AS schema_loaded
            FROM provided_lots p
            LEFT JOIN ranked r ON p.lot_id = r.lot_id AND r.rn = 1
            ORDER BY schema_loaded, p.lot_id
            """;

    // ── Snowflake SQL: no date filter ──────────────────────────────────────────
    static final String LOT_CHECK_SQL_NO_DATE = """
            WITH provided_lots AS (
                SELECT value::VARCHAR AS lot_id
                FROM TABLE(FLATTEN(PARSE_JSON(?)))
            ),
            found_lots AS (
                SELECT DISTINCT LOT_ID, SCHEMANAME
                FROM ANALYTICSPRD.MFG.EXENSIO_PROD_OPLOG_METADATA
                WHERE PGC_KEY = 2
                  AND LOT_ID IN (SELECT lot_id FROM provided_lots)
            ),
            ranked AS (
                SELECT LOT_ID, SCHEMANAME,
                       ROW_NUMBER() OVER (
                           PARTITION BY LOT_ID
                           ORDER BY CASE WHEN UPPER(SCHEMANAME) LIKE '%PROD%' THEN 0 ELSE 1 END
                       ) AS rn
                FROM found_lots
            )
            SELECT p.lot_id, COALESCE(r.SCHEMANAME, 'NOT FOUND') AS schema_loaded
            FROM provided_lots p
            LEFT JOIN ranked r ON p.lot_id = r.lot_id AND r.rn = 1
            ORDER BY schema_loaded, p.lot_id
            """;

    private final ExensioProperties exensioProperties;
    private final ExensioAuthService authService;
    private final ObjectMapper objectMapper;
    private final HttpClient httpClient;
    private final DataSource snowflakeDataSource;
    private final int precheckRowLimit;

    public ExensioPreCheckService(
            ExensioProperties exensioProperties,
            ExensioAuthService authService,
            ObjectMapper objectMapper,
            @Qualifier("snowflakeDataSource") DataSource snowflakeDataSource,
            @Value("${exensio.precheck-row-limit:10000}") int precheckRowLimit) {
        this.exensioProperties = exensioProperties;
        this.authService = authService;
        this.objectMapper = objectMapper;
        this.snowflakeDataSource = snowflakeDataSource;
        this.precheckRowLimit = precheckRowLimit;
        this.httpClient = HttpClient.newBuilder()
                .followRedirects(HttpClient.Redirect.NEVER)
                .connectTimeout(Duration.ofSeconds(10))
                .build();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Public API — 3.9 orchestration
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Checks whether the submitted lots exist in Exensio.
     * Tries Snowflake JDBC first; falls back to Exensio HTTP raw-SQL on failure.
     * Returns a soft-failure response (with {@code error} field) rather than throwing.
     */
    public ExensioPreCheckResponse check(ExensioPreCheckRequest request) {
        if (request.lotIds() == null || request.lotIds().isEmpty()) {
            return new ExensioPreCheckResponse(
                    Collections.emptyList(),
                    Collections.emptyList(),
                    Collections.emptyList(),
                    null);
        }

        // Primary: Snowflake JDBC
        ExensioPreCheckResponse snowflakeResult = checkViaSnowflake(request);
        if (snowflakeResult != null) {
            return snowflakeResult;
        }

        // Fallback: Exensio HTTP raw-SQL
        if (!exensioProperties.isConfigured()) {
            log.warn("[ExensioPreCheck] Snowflake failed and Exensio is not configured — returning soft error");
            return softError("Snowflake unavailable and Exensio is not configured");
        }

        ExensioPreCheckResponse httpResult = checkViaExensioHttp(request);
        if (httpResult != null) {
            return httpResult;
        }

        // Both paths failed
        return softError("Both Snowflake and Exensio pre-check paths failed");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 3.7 Primary: Snowflake JDBC
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Executes the pre-check query via Snowflake JDBC.
     *
     * @return populated response on success, {@code null} to signal fallback should be used
     */
    ExensioPreCheckResponse checkViaSnowflake(ExensioPreCheckRequest request) {
        if (request.lotIds() == null || request.lotIds().isEmpty()) {
            return new ExensioPreCheckResponse(
                    Collections.emptyList(),
                    Collections.emptyList(),
                    Collections.emptyList(),
                    null);
        }

        String lotIdsJson = buildLotIdsJson(request.lotIds());
        String yearMonth  = deriveEarliestYearMonth(request.blocks());

        log.debug("[ExensioPreCheck] Snowflake query: lots={}, yearMonth={}",
                request.lotIds().size(), yearMonth);

        try (Connection conn = snowflakeDataSource.getConnection()) {
            PreparedStatement ps;
            if (yearMonth != null) {
                ps = conn.prepareStatement(LOT_CHECK_SQL_WITH_DATE);
                ps.setString(1, lotIdsJson);
                ps.setString(2, yearMonth);
            } else {
                ps = conn.prepareStatement(LOT_CHECK_SQL_NO_DATE);
                ps.setString(1, lotIdsJson);
            }

            try (ps; ResultSet rs = ps.executeQuery()) {
                List<ExensioPreCheckRow> rows = new ArrayList<>();
                while (rs.next()) {
                    rows.add(new ExensioPreCheckRow(
                            rs.getString("lot_id"),
                            rs.getString("schema_loaded")));
                }
                log.debug("[ExensioPreCheck] Snowflake returned {} rows", rows.size());
                return partitionResults(rows, request.lotIds());
            }

        } catch (SQLException e) {
            log.warn("[ExensioPreCheck] Snowflake JDBC failed — will try Exensio HTTP fallback: {}", e.getMessage());
            return null; // signal to use fallback
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 3.8 Fallback: Exensio HTTP raw-SQL
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Executes the pre-check query via the Exensio HTTP {@code POST /v1/key/raw-sql} endpoint.
     * Reuses the existing Oracle SQL builder and re-logs on 401 with one token refresh.
     *
     * @return populated response, or {@code null} if this path also fails
     */
    ExensioPreCheckResponse checkViaExensioHttp(ExensioPreCheckRequest request) {
        String schema = resolveSchema(request.environment());
        String sql    = buildSql(request.lotIds(), request.blocks());

        log.debug("[ExensioPreCheck] HTTP fallback: lots={}, schema={}", request.lotIds().size(), schema);

        try {
            String token       = authService.getToken(schema);
            String responseBody = callRawSql(sql, token, schema);

            if (responseBody == null) {
                return softError("Authentication failed after token refresh");
            }

            return parseResponse(responseBody, request.lotIds());

        } catch (ExensioAuthService.ExensioAuthException e) {
            log.warn("[ExensioPreCheck] HTTP fallback auth error: {}", e.getMessage());
            return softError("Exensio authentication error: " + e.getMessage());
        } catch (Exception e) {
            log.warn("[ExensioPreCheck] HTTP fallback unexpected error: {}", e.getMessage());
            return softError("Exensio pre-check error: " + e.getMessage());
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 3.1 buildLotIdsJson
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Serializes a list of lot IDs into a JSON array string suitable for use as a
     * Snowflake JDBC {@code PARSE_JSON(?)} bind parameter.
     *
     * <p>Double-quote characters within lot ID values are escaped as {@code \"}.</p>
     *
     * <p>Example: {@code ["LOT001","LOT002"]}.</p>
     *
     * @param lotIds non-null, non-empty list of lot IDs
     * @return JSON array string, e.g. {@code ["LOT001","LOT002"]}
     * @throws IllegalArgumentException if lotIds is null
     */
    public static String buildLotIdsJson(List<String> lotIds) {
        if (lotIds == null) {
            throw new IllegalArgumentException("lotIds must not be null");
        }
        return "[" + lotIds.stream()
                .map(id -> "\"" + (id == null ? "" : id).replace("\\", "\\\\").replace("\"", "\\\"") + "\"")
                .collect(Collectors.joining(",")) + "]";
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 3.3 deriveEarliestYearMonth
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Derives the earliest {@code 'YYYY-MM'} formatted string from the provided blocks
     * for use as the Snowflake {@code INSERT_TIME} lower-bound bind parameter.
     *
     * <ul>
     *   <li>If a block has both year and month, uses that year-month.</li>
     *   <li>If a block has only a year (no month), treats it as {@code year-01} (January).</li>
     *   <li>If no blocks have a year, returns {@code null} (no date filter).</li>
     *   <li>The earliest year-month across all blocks is returned.</li>
     * </ul>
     *
     * @param blocks optional list of pre-check blocks (may be null or empty)
     * @return {@code 'YYYY-MM'} string for the earliest year+month, or {@code null}
     */
    public static String deriveEarliestYearMonth(List<PreCheckBlock> blocks) {
        if (blocks == null || blocks.isEmpty()) {
            return null;
        }

        String earliest = null;

        for (PreCheckBlock block : blocks) {
            if (block.year() == null) {
                continue;
            }
            int month = (block.month() != null) ? block.month() : 1;
            String candidate = String.format("%04d-%02d", block.year(), month);

            if (earliest == null || candidate.compareTo(earliest) < 0) {
                earliest = candidate;
            }
        }

        return earliest; // null when no block has a year
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 3.5 partitionResults
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Partitions submitted lot IDs into {@code lotsFound} and {@code lotsNotFound} based
     * on Snowflake result rows.
     *
     * <ul>
     *   <li>Rows with {@code schemaName = 'NOT FOUND'} contribute to {@code lotsNotFound}.</li>
     *   <li>Rows with any other {@code schemaName} contribute to {@code lotsFound}.</li>
     *   <li>Comparison against submitted lot IDs is case-insensitive.</li>
     * </ul>
     *
     * @param rows           rows returned from the Snowflake query
     * @param submittedLotIds the original lot IDs from the request
     * @return {@link ExensioPreCheckResponse} with partitioned lists (no error field)
     */
    public static ExensioPreCheckResponse partitionResults(
            List<ExensioPreCheckRow> rows,
            List<String> submittedLotIds) {

        // Collect lot IDs that have an actual Snowflake record (schema ≠ NOT FOUND)
        Set<String> foundUpper = rows.stream()
                .filter(r -> !"NOT FOUND".equalsIgnoreCase(r.schemaName()))
                .map(r -> r.lotId().toUpperCase())
                .collect(Collectors.toCollection(LinkedHashSet::new));

        List<String> lotsFound = submittedLotIds.stream()
                .filter(l -> foundUpper.contains(l.toUpperCase()))
                .collect(Collectors.toList());

        List<String> lotsNotFound = submittedLotIds.stream()
                .filter(l -> !foundUpper.contains(l.toUpperCase()))
                .collect(Collectors.toList());

        // Only include rows that were actually found (exclude NOT FOUND sentinel rows)
        List<ExensioPreCheckRow> foundRows = rows.stream()
                .filter(r -> !"NOT FOUND".equalsIgnoreCase(r.schemaName()))
                .collect(Collectors.toList());

        return new ExensioPreCheckResponse(lotsFound, lotsNotFound, foundRows, null);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Oracle SQL builder (HTTP fallback) — preserved from original service
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Builds the Oracle SQL query for the Exensio raw-SQL endpoint.
     */
    public String buildSql(List<String> lotIds, List<PreCheckBlock> blocks) {
        StringBuilder sb = new StringBuilder();

        sb.append("SELECT * FROM (\n");
        sb.append("  SELECT\n");
        sb.append("    l.lot_id                                                         AS lot_id,\n");
        sb.append("    NVL(TO_CHAR(ol.end_time,'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'), '') AS end_time,\n");
        sb.append("    NVL(p.ppid, '')                                                  AS ppid,\n");
        sb.append("    NVL(w.wf_id, '')                                                 AS wafer_id\n");
        sb.append("  FROM op_log ol\n");
        sb.append("  JOIN lot      l   ON l.lot_key  = ol.lot_key\n");
        sb.append("  JOIN program  p   ON p.pg_key   = ol.pg_key\n");
        sb.append("  LEFT JOIN wf_log  wfl ON wfl.lg_key = ol.lg_key\n");
        sb.append("  LEFT JOIN wafer   w   ON w.wf_key   = wfl.wf_key\n");

        sb.append("  WHERE UPPER(TRIM(l.lot_id)) IN (");
        for (int i = 0; i < lotIds.size(); i++) {
            if (i > 0) sb.append(", ");
            sb.append("UPPER(TRIM('").append(escapeSql(lotIds.get(i))).append("'))");
        }
        sb.append(")\n");

        List<String> dateRangeClauses = buildDateRangeClauses(blocks);
        if (!dateRangeClauses.isEmpty()) {
            sb.append("  AND (\n");
            for (int i = 0; i < dateRangeClauses.size(); i++) {
                if (i > 0) sb.append("    OR ");
                else sb.append("    ");
                sb.append("(").append(dateRangeClauses.get(i)).append(")\n");
            }
            sb.append("  )\n");
        }

        sb.append("  ORDER BY l.lot_id, ol.end_time DESC\n");
        sb.append(") WHERE ROWNUM <= ").append(precheckRowLimit);

        return sb.toString();
    }

    /**
     * Parses the Exensio raw-SQL JSON response and partitions the submitted lot IDs.
     * Maps HTTP fallback rows (LOT_ID / END_TIME / PPID / WAFER_ID) to the unified
     * {@link ExensioPreCheckRow} shape ({@code lotId} + {@code schemaName}).
     * For HTTP fallback results, {@code schemaName} is set to {@code "FOUND"} when a
     * row is present (the Oracle query does not return a schema name).
     */
    public ExensioPreCheckResponse parseResponse(String jsonResponse, List<String> submittedLotIds) {
        try {
            JsonNode root     = objectMapper.readTree(jsonResponse);
            JsonNode rowsNode = root.path("rows");

            List<ExensioPreCheckRow> rows = new ArrayList<>();
            if (rowsNode.isArray()) {
                for (JsonNode rowNode : rowsNode) {
                    String lotId = rowNode.path("LOT_ID").asText("");
                    // HTTP fallback doesn't return SCHEMANAME — use "FOUND" as sentinel
                    rows.add(new ExensioPreCheckRow(lotId, "FOUND"));
                }
            }

            Set<String> foundUpper = rows.stream()
                    .map(r -> r.lotId().toUpperCase())
                    .collect(Collectors.toSet());

            List<String> lotsFound = submittedLotIds.stream()
                    .filter(l -> foundUpper.contains(l.toUpperCase()))
                    .collect(Collectors.toList());

            List<String> lotsNotFound = submittedLotIds.stream()
                    .filter(l -> !foundUpper.contains(l.toUpperCase()))
                    .collect(Collectors.toList());

            return new ExensioPreCheckResponse(lotsFound, lotsNotFound, rows, null);

        } catch (Exception e) {
            log.warn("[ExensioPreCheck] Failed to parse HTTP response: {}", e.getMessage());
            return softError("Failed to parse Exensio response: " + e.getMessage());
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // HTTP helpers — preserved from original service
    // ─────────────────────────────────────────────────────────────────────────

    private String callRawSql(String sql, String token, String schema) throws Exception {
        String result = doCallRawSql(sql, token, schema);
        if (result == null) {
            authService.invalidateToken(schema);
            String refreshedToken = authService.login(schema);
            result = doCallRawSql(sql, refreshedToken, schema);
        }
        return result;
    }

    private String doCallRawSql(String sql, String token, String schema) throws Exception {
        String url = exensioProperties.resolvedBaseUrl().replaceAll("/$", "") + "/v1/key/raw-sql";

        String bodyJson = objectMapper.createObjectNode()
                .put("sql", sql)
                .toString();

        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(url))
                .timeout(Duration.ofSeconds(60))
                .header("Authorization", "Bearer " + token)
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(bodyJson))
                .build();

        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        log.debug("[ExensioPreCheck] raw-sql response: HTTP {}, schema={}", response.statusCode(), schema);

        if (response.statusCode() == 401) {
            return null;
        }

        if (response.statusCode() < 200 || response.statusCode() >= 300) {
            throw new RuntimeException("Exensio raw-sql returned HTTP " + response.statusCode()
                    + ": " + response.body());
        }

        return response.body();
    }

    private List<String> buildDateRangeClauses(List<PreCheckBlock> blocks) {
        if (blocks == null || blocks.isEmpty()) {
            return Collections.emptyList();
        }

        Set<String> seen = new java.util.LinkedHashSet<>();
        List<String> clauses = new ArrayList<>();

        for (PreCheckBlock block : blocks) {
            if (block.year() == null) continue;

            String key = block.year() + "-" + (block.month() != null ? block.month() : "null");
            if (!seen.add(key)) continue;

            if (block.month() == null) {
                clauses.add(yearOnlyClause(block.year()));
            } else {
                clauses.add(yearMonthClause(block.year(), block.month()));
            }
        }

        return clauses;
    }

    static String yearOnlyClause(int year) {
        return "TRUNC(ol.end_time) >= TO_DATE('" + year + "-01-01','YYYY-MM-DD') " +
               "AND TRUNC(ol.end_time) < TO_DATE('" + (year + 1) + "-01-01','YYYY-MM-DD')";
    }

    static String yearMonthClause(int year, int month) {
        String monthStr = String.format("%02d", month);
        String dateStr  = year + "-" + monthStr + "-01";
        return "TRUNC(ol.end_time) >= TO_DATE('" + dateStr + "','YYYY-MM-DD') " +
               "AND TRUNC(ol.end_time) < ADD_MONTHS(TO_DATE('" + dateStr + "','YYYY-MM-DD'), 1)";
    }

    static String escapeSql(String value) {
        if (value == null) return "";
        return value.replace("'", "''");
    }

    private String resolveSchema(String environment) {
        String schema = exensioProperties.getDbschema();
        return (schema != null && !schema.isBlank()) ? schema : "PRODUCTION";
    }

    private static ExensioPreCheckResponse softError(String message) {
        return new ExensioPreCheckResponse(
                Collections.emptyList(),
                Collections.emptyList(),
                Collections.emptyList(),
                message);
    }
}
