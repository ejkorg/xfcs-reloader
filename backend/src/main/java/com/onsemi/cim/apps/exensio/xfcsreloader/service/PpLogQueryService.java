package com.onsemi.cim.apps.exensio.xfcsreloader.service;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.List;
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

    @PersistenceContext
    private EntityManager entityManager;

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

        try {
            // Split fileName into stem (FILE_NAME) and extension (EXTENSION)
            String fileNameNoExt = fileName;
            String extension = null;

            int lastDotIdx = fileName.lastIndexOf('.');
            if (lastDotIdx > 0) {
                fileNameNoExt = fileName.substring(0, lastDotIdx);
                extension = fileName.substring(lastDotIdx + 1);
            }

            // Build and execute the SQL query
            @SuppressWarnings("unchecked")
            List<Object[]> results;
            if (extension != null && !extension.isBlank()) {
                String sql = "SELECT OUTPUT_DIRECTORY, LOG_MESSAGE FROM refdb.pp_log " +
                      "WHERE LOT = :lot " +
                      "AND UPPER(ENVIRONMENT) = UPPER(:environment) " +
                      "AND FILE_NAME = :fileNameNoExt " +
                      "AND UPPER(EXTENSION) = UPPER(:extension) " +
                      "ORDER BY PROCESS_DATETIME DESC " +
                      "FETCH FIRST 1 ROWS ONLY";
                results = (List<Object[]>) entityManager.createNativeQuery(sql)
                        .setParameter("lot", lot)
                        .setParameter("environment", environment)
                        .setParameter("fileNameNoExt", fileNameNoExt)
                        .setParameter("extension", extension)
                        .getResultList();
            } else {
                String sql = "SELECT OUTPUT_DIRECTORY, LOG_MESSAGE FROM refdb.pp_log " +
                      "WHERE LOT = :lot " +
                      "AND UPPER(ENVIRONMENT) = UPPER(:environment) " +
                      "AND FILE_NAME = :fileNameNoExt " +
                      "ORDER BY PROCESS_DATETIME DESC " +
                      "FETCH FIRST 1 ROWS ONLY";
                results = (List<Object[]>) entityManager.createNativeQuery(sql)
                        .setParameter("lot", lot)
                        .setParameter("environment", environment)
                        .setParameter("fileNameNoExt", fileNameNoExt)
                        .getResultList();
            }

            if (results.isEmpty()) {
                log.debug("[PpLogQuery] No pp_log record found for lot={}, env={}, fileName={}", lot, environment, fileName);
                return null;
            }

            Object[] row = results.get(0);
            String outputDirectory = (String) row[0];
            String logMessage = (String) row[1];

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
     * Splits by " --- ", returns first segment containing "Bad" or "Not found" (case-insensitive).
     * Returns null if no qualifying segment found.
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
            if (trimmed.isEmpty()) continue;

            String lowerSegment = trimmed.toLowerCase(Locale.ROOT);
            if (lowerSegment.contains("bad") || lowerSegment.contains("not found")) {
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
