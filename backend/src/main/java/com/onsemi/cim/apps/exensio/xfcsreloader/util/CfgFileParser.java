package com.onsemi.cim.apps.exensio.xfcsreloader.util;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Parses .cfg files to extract environment folder paths.
 *
 * .cfg file format (one active entry per file):
 *   <inbox_path>:<script_path>:<file_pattern>: [options...]
 *
 * Example:
 *   $DPDATA/data/cpft_eagle/inbox/Processed:$DPSCRIPT/fcs_eagle_log_IFF.pl:%: --site cpft --loc CP --out /archives/edbcp/cpft_eagle
 *
 * The inbox path is the FIRST colon-delimited field.
 * Options like --out, --loc are embedded in the last field.
 */
public class CfgFileParser {

    private static final Logger log = LoggerFactory.getLogger(CfgFileParser.class);

    private static final Pattern OUT_FLAG   = Pattern.compile("--out\\s+(\\S+)");
    private static final Pattern LOG_FLAG   = Pattern.compile("--log\\s+(\\S+)");
    private static final Pattern LOC_FLAG   = Pattern.compile("--loc\\s+(\\S+)");
    private static final Pattern SITE_FLAG  = Pattern.compile("--site\\s+(\\S+)");

    /**
     * Result of parsing a .cfg file.
     */
    public record CfgInfo(
            /** Raw inbox path as written in the file (may contain $VAR tokens). */
            String rawInboxPath,
            /** Expanded inbox path (env vars resolved). */
            String expandedInboxPath,
            /** Inbox path stripped of processing suffixes (/Processed, /NotProcessed, /dearchive). */
            String normalizedInboxPath,
            /** Raw outbox path from --out flag (may contain $VAR tokens). */
            String rawOutboxPath,
            /** Expanded outbox path. */
            String expandedOutboxPath,
            /** Raw log path from --log flag (may contain $VAR tokens). */
            String rawLogPath,
            /** Expanded log path from --log flag. */
            String expandedLogPath,
            /** Location code from --loc flag (e.g. "CP"). */
            String locationCode,
            /** Site code from --site flag (e.g. "cpft"). */
            String siteCode
    ) {}

    /**
     * Parses .cfg content from a string (e.g. content read via SSH).
     * Same logic as {@link #parse(Path, Map)} but operates on already-read text.
     */
    public static CfgInfo parseContent(String content, Map<String, String> envVars) {
        if (content == null || content.isBlank()) return null;
        for (String raw : content.split("\\r?\\n")) {
            String line = raw.trim();
            if (line.isEmpty() || line.startsWith("#")) continue;

            String[] parts = line.split(":", -1);
            if (parts.length < 1 || parts[0].isBlank()) continue;

            String rawInbox = parts[0].trim();
            String expandedInbox = MgrConfigParser.expandVars(rawInbox, envVars);
            String normalizedInbox = stripProcessingSuffix(expandedInbox);

            String remainder = parts.length > 3 ? String.join(":", java.util.Arrays.copyOfRange(parts, 3, parts.length)) : "";
            String rawOutbox = extractFlag(OUT_FLAG, remainder);
            String expandedOutbox = MgrConfigParser.expandVars(rawOutbox, envVars);
            String rawLog = extractFlag(LOG_FLAG, remainder);
            String expandedLog = MgrConfigParser.expandVars(rawLog, envVars);
            String locationCode = extractFlag(LOC_FLAG, remainder);
            String siteCode = extractFlag(SITE_FLAG, remainder);

            return new CfgInfo(rawInbox, expandedInbox, normalizedInbox, rawOutbox, expandedOutbox, rawLog, expandedLog, locationCode, siteCode);
        }
        return null;
    }

    /**
     * Parses a .cfg file and returns the extracted paths and metadata.
     *
     * @param cfgPath   path to the .cfg file
     * @param envVars   additional environment variable overrides for path expansion
     * @return CfgInfo, or null if file not found or unparseable
     */
    public static CfgInfo parse(Path cfgPath, Map<String, String> envVars) {
        if (cfgPath == null || !Files.exists(cfgPath)) {
            log.warn("[CfgFileParser] .cfg file not found: {}", cfgPath);
            return null;
        }

        List<String> lines;
        try {
            lines = Files.readAllLines(cfgPath);
        } catch (IOException e) {
            log.error("[CfgFileParser] Failed to read .cfg file: {}", cfgPath, e);
            return null;
        }

        for (String raw : lines) {
            String line = raw.trim();
            if (line.isEmpty() || line.startsWith("#")) continue;

            // First colon-delimited field is the inbox path
            String[] parts = line.split(":", -1);
            if (parts.length < 1 || parts[0].isBlank()) continue;

            String rawInbox = parts[0].trim();
            String expandedInbox = MgrConfigParser.expandVars(rawInbox, envVars);
            String normalizedInbox = stripProcessingSuffix(expandedInbox);

            // Extract outbox from --out flag in remainder of line
            String remainder = parts.length > 3 ? String.join(":", java.util.Arrays.copyOfRange(parts, 3, parts.length)) : "";
            String rawOutbox = extractFlag(OUT_FLAG, remainder);
            String expandedOutbox = MgrConfigParser.expandVars(rawOutbox, envVars);
            String rawLog = extractFlag(LOG_FLAG, remainder);
            String expandedLog = MgrConfigParser.expandVars(rawLog, envVars);
            String locationCode = extractFlag(LOC_FLAG, remainder);
            String siteCode = extractFlag(SITE_FLAG, remainder);

            log.debug("[CfgFileParser] Parsed cfg={}: rawInbox='{}', normalized='{}', outbox='{}', loc='{}'",
                    cfgPath, rawInbox, normalizedInbox, rawOutbox, locationCode);

            return new CfgInfo(rawInbox, expandedInbox, normalizedInbox, rawOutbox, expandedOutbox, rawLog, expandedLog, locationCode, siteCode);
        }

        log.warn("[CfgFileParser] No valid active entry found in .cfg file: {}", cfgPath);
        return null;
    }

    /**
     * Strips known processing suffixes from an inbox path to get the base inbox directory.
     *
     * Examples:
     *   /apps/exensio_data/data/cpft_eagle/inbox/Processed    → /apps/exensio_data/data/cpft_eagle/inbox
     *   /apps/exensio_data/data/cpft_eagle/inbox/NotProcessed  → /apps/exensio_data/data/cpft_eagle/inbox
     *   /apps/exensio_data/data/cpft_eagle/inbox/dearchive     → /apps/exensio_data/data/cpft_eagle/inbox
     *   /apps/exensio_data/data/cpft_eagle/inbox               → /apps/exensio_data/data/cpft_eagle/inbox (unchanged)
     */
    public static String stripProcessingSuffix(String path) {
        if (path == null) return null;
        String normalized = path.replace("\\", "/");
        // Remove trailing slash
        if (normalized.endsWith("/")) {
            normalized = normalized.substring(0, normalized.length() - 1);
        }
        // Strip known suffixes
        for (String suffix : List.of("/Processed", "/NotProcessed", "/dearchive", "/processed", "/notprocessed")) {
            if (normalized.endsWith(suffix)) {
                return normalized.substring(0, normalized.length() - suffix.length());
            }
        }
        return normalized;
    }

    private static String extractFlag(Pattern pattern, String text) {
        if (text == null || text.isBlank()) return null;
        Matcher m = pattern.matcher(text);
        return m.find() ? m.group(1) : null;
    }
}
