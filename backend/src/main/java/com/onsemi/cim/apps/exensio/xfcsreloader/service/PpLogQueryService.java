package com.onsemi.cim.apps.exensio.xfcsreloader.service;

import com.onsemi.cim.apps.exensio.xfcsreloader.config.PpLogDbProperties;
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.util.Locale;

/**
 * Query service for the production Oracle refdb.pp_log table.
 * Provides methods to look up ETL destination and error/sandbox reason data
 * from pp_log, with parsing utilities for LOG_MESSAGE extraction.
 *
 * Feature: stepper-pplog-enhancements, Properties 5-8
 * Validates: Requirements 4.1-4.6, 5.1-5.4, 6.1-6.5
 */
@Service
public class PpLogQueryService {

    private static final Logger log = LoggerFactory.getLogger(PpLogQueryService.class);

    private final DataSource mainDataSource;
    private final PpLogDbProperties ppLogDbProperties;
    private HikariDataSource ppLogDataSource;

    public PpLogQueryService(DataSource mainDataSource, PpLogDbProperties ppLogDbProperties) {
        this.mainDataSource = mainDataSource;
        this.ppLogDbProperties = ppLogDbProperties;
    }

    @PostConstruct
    public void init() {
        if (ppLogDbProperties != null && ppLogDbProperties.isPpLogAvailable()) {
            try {
                HikariConfig ppConfig = new HikariConfig();
                ppConfig.setJdbcUrl(ppLogDbProperties.buildJdbcUrl());
                ppConfig.setUsername(ppLogDbProperties.getUser());
                ppConfig.setPassword(ppLogDbProperties.getPassword());
                ppConfig.setDriverClassName("oracle.jdbc.OracleDriver");
                ppConfig.setMaximumPoolSize(ppLogDbProperties.getPool().getMaxSize());
                ppConfig.setMinimumIdle(ppLogDbProperties.getPool().getMinIdle());
                ppConfig.setPoolName("xfcs-pplog-prod");
                this.ppLogDataSource = new HikariDataSource(ppConfig);
                log.info("[PpLogQueryService] Separate pp_log datasource initialized pointing to PRODUCTION: {}", 
                         ppLogDbProperties.buildJdbcUrl());
            } catch (Exception e) {
                log.error("[PpLogQueryService] Failed to initialize separate production pp_log datasource: {}", e.getMessage(), e);
            }
        } else {
            log.info("[PpLogQueryService] Separate pp_log datasource not configured; using main database connection.");
        }
    }

    @PreDestroy
    public void shutdown() {
        if (ppLogDataSource != null) {
            try {
                ppLogDataSource.close();
                log.info("[PpLogQueryService] Separate pp_log datasource closed.");
            } catch (Exception e) {
                log.warn("[PpLogQueryService] Error closing separate pp_log datasource: {}", e.getMessage());
            }
        }
    }

    private DataSource getDataSource() {
        return ppLogDataSource != null ? ppLogDataSource : mainDataSource;
    }

    /**
     * Result of a pp_log lookup for a single file.
     *
     * @param destination "PRODUCTION", "SANDBOX", "NOT_PROCESSED", or null if not found
     * @param reason      sandbox or error reason extracted from LOG_MESSAGE, may be null
     */
    public record PpLogResult(
        String destination,
        String reason
    ) {}

    /**
     * Queries refdb.pp_log for the most recent record matching the given lot, environment,
     * and filename. The fileName is split internally into FILE_NAME (stem without extension)
     * and EXTENSION for the query.
     *
     * Returns null if no record is found or the query fails.
     *
     * Validates: Requirements 4.1, 4.2, 4.6
     *
     * Feature: stepper-pplog-enhancements, Property 5: Most-recent pp_log row selection
     *
     * @param lot         the lot ID (VARCHAR2 32)
     * @param environment the environment name (VARCHAR2 32)
     * @param fileName    the full filename (e.g., "P002317366_BIN_reloaded_20260624142138.SPD")
     * @return PpLogResult with destination and reason, or null if not found/error
     */
    public PpLogResult queryByLotAndEnv(String lot, String environment, String fileName) {
        if (lot == null || lot.isBlank() || environment == null || environment.isBlank() ||
            fileName == null || fileName.isBlank()) {
            return null;
        }

        // Split fileName into stem (FILE_NAME) and extension (EXTENSION)
        String fileNameNoExt = fileName;
        String extension = null;

        int lastDotIdx = fileName.lastIndexOf('.');
        if (lastDotIdx > 0) {
            fileNameNoExt = fileName.substring(0, lastDotIdx);
            extension = fileName.substring(lastDotIdx + 1);
        }

        try (Connection conn = getDataSource().getConnection()) {
            String sql;
            if (extension != null && !extension.isBlank()) {
                sql = "SELECT OUTPUT_DIRECTORY, LOG_MESSAGE FROM refdb.pp_log " +
                      "WHERE LOT = ? " +
                      "AND UPPER(ENVIRONMENT) = UPPER(?) " +
                      "AND FILE_NAME = ? " +
                      "AND UPPER(EXTENSION) = UPPER(?) " +
                      "ORDER BY PROCESS_DATETIME DESC " +
                      "FETCH FIRST 1 ROWS ONLY";
            } else {
                sql = "SELECT OUTPUT_DIRECTORY, LOG_MESSAGE FROM refdb.pp_log " +
                      "WHERE LOT = ? " +
                      "AND UPPER(ENVIRONMENT) = UPPER(?) " +
                      "AND FILE_NAME = ? " +
                      "ORDER BY PROCESS_DATETIME DESC " +
                      "FETCH FIRST 1 ROWS ONLY";
            }

            try (PreparedStatement ps = conn.prepareStatement(sql)) {
                ps.setString(1, lot);
                ps.setString(2, environment);
                ps.setString(3, fileNameNoExt);
                if (extension != null && !extension.isBlank()) {
                    ps.setString(4, extension);
                }

                try (ResultSet rs = ps.executeQuery()) {
                    if (rs.next()) {
                        String outputDirectory = rs.getString("OUTPUT_DIRECTORY");
                        String logMessage = rs.getString("LOG_MESSAGE");

                        // Derive destination from OUTPUT_DIRECTORY
                        String destination = deriveDestination(outputDirectory);

                        // Extract reason based on destination
                        String reason = null;
                        if ("SANDBOX".equals(destination)) {
                            reason = extractSandboxReason(logMessage);
                        } else if ("NOT_PROCESSED".equals(destination)) {
                            reason = extractErrorReason(logMessage);
                        }

                        log.debug("[PpLogQuery] Found pp_log record: lot={}, env={}, destination={}, reason={}", 
                                lot, environment, destination, reason);

                        return new PpLogResult(destination, reason);
                    } else {
                        log.debug("[PpLogQuery] No pp_log record found for lot={}, env={}, fileName={}", lot, environment, fileName);
                        return null;
                    }
                }
            }
        } catch (Exception ex) {
            log.warn("[PpLogQuery] Error querying pp_log for lot={}, env={}, fileName={}: {}", 
                    lot, environment, fileName, ex.getMessage());
            return null;
        }
    }

    /**
     * Derives destination string from OUTPUT_DIRECTORY value.
     *   - contains "sandbox" (case-insensitive) → "SANDBOX"
     *   - contains "NotProcessed" (case-insensitive) → "NOT_PROCESSED"
     *   - otherwise → "PRODUCTION"
     *
     * Validates: Requirement 4.3
     * Feature: stepper-pplog-enhancements, Property 6: Destination derivation from OUTPUT_DIRECTORY
     *
     * @param outputDirectory the OUTPUT_DIRECTORY value from pp_log
     * @return "PRODUCTION", "SANDBOX", or "NOT_PROCESSED"
     */
    public static String deriveDestination(String outputDirectory) {
        if (outputDirectory == null || outputDirectory.isBlank()) {
            return "PRODUCTION";
        }

        String lower = outputDirectory.toLowerCase(Locale.ROOT);
        if (lower.contains("sandbox")) {
            return "SANDBOX";
        }
        if (lower.contains("notprocessed")) {
            return "NOT_PROCESSED";
        }
        return "PRODUCTION";
    }

    /**
     * Extracts sandbox reason from LOG_MESSAGE.
     * Splits by " --- ", returns the first non-empty segment.
     *
     * Validates: Requirement 5.2
     * Feature: stepper-pplog-enhancements, Property 7: Sandbox reason extraction from LOG_MESSAGE
     *
     * @param logMessage the LOG_MESSAGE value from pp_log
     * @return the extracted reason, or null if not found
     */
    public static String extractSandboxReason(String logMessage) {
        if (logMessage == null || logMessage.isBlank()) {
            return null;
        }

        String[] segments = logMessage.split(" --- ");
        for (String segment : segments) {
            if (segment == null) continue;
            String trimmed = segment.trim();
            if (!trimmed.isEmpty()) {
                return trimmed;
            }
        }

        return null;
    }

    /**
     * Extracts error reason for NotProcessed files from LOG_MESSAGE.
     * Splits by " --- ", returns the last non-empty segment.
     * If the last segment is blank/trivial, returns the first segment containing
     * "Bad" or "Not found" (case-insensitive).
     * Returns null if LOG_MESSAGE is blank or no meaningful segment found.
     *
     * Validates: Requirement 6.2
     * Feature: stepper-pplog-enhancements, Property 8: NotProcessed error reason extraction from LOG_MESSAGE
     *
     * @param logMessage the LOG_MESSAGE value from pp_log
     * @return the extracted error reason, or null if not found
     */
    public static String extractErrorReason(String logMessage) {
        if (logMessage == null || logMessage.isBlank()) {
            return null;
        }

        String[] segments = logMessage.split(" --- ");

        // Find the last non-empty segment
        String lastNonEmpty = null;
        for (int i = segments.length - 1; i >= 0; i--) {
            if (segments[i] != null && !segments[i].trim().isEmpty()) {
                lastNonEmpty = segments[i].trim();
                break;
            }
        }

        // If the last segment is meaningful (not just whitespace/numbers/boilerplate), use it
        if (lastNonEmpty != null && isNonTrivialReason(lastNonEmpty)) {
            return lastNonEmpty;
        }

        // Fall back to the first segment containing "Bad" or "Not found"
        for (String segment : segments) {
            if (segment == null) continue;
            String trimmed = segment.trim();
            if (trimmed.isEmpty()) continue;

            String lowerSegment = trimmed.toLowerCase(Locale.ROOT);
            if (lowerSegment.contains("bad") || lowerSegment.contains("not found")) {
                return trimmed;
            }
        }

        // If no segment with "Bad"/"Not found", use the last non-empty segment if it exists
        if (lastNonEmpty != null) {
            return lastNonEmpty;
        }

        return null;
    }

    /**
     * Checks if a reason string is non-trivial (not just boilerplate).
     * Returns true if the string contains meaningful content beyond simple markers.
     */
    private static boolean isNonTrivialReason(String reason) {
        if (reason == null || reason.isBlank()) return false;
        
        String lower = reason.toLowerCase(Locale.ROOT);
        
        // Exclude pure numbers, pure whitespace, or very short markers
        if (reason.matches("^[0-9\\s]+$")) return false;
        if (lower.length() < 3) return false;
        
        // Exclude pure "Good" or similar boilerplate markers
        if (lower.equals("good") || lower.equals("ok") || lower.equals("done")) return false;
        
        return true;
    }
}
