package com.onsemi.cim.apps.exensio.xfcsreloader.util;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Parses .mgr files to map environment names to their .cfg file paths.
 *
 * .mgr file format (one entry per line):
 *   <cfg_path> : <options> : <environment_name>
 *
 * Example:
 *   $DPLOAD/fcs_pp_cpft_eagle.cfg : -mtime -log $DPLOG/fcs_pp.log -sleep 60 : CPFT_EAGLE
 *
 * Lines starting with '#' are treated as comments and ignored.
 */
public class MgrConfigParser {

    private static final Logger log = LoggerFactory.getLogger(MgrConfigParser.class);

    // Matches: <cfg_path> : <options> : <env_name>
    // cfg_path may contain $VAR or ${VAR} references
    private static final Pattern MGR_LINE_PATTERN =
            Pattern.compile("^([^:#][^:]*?)\\s*:\\s*(.*?)\\s*:\\s*([A-Za-z0-9_]+)\\s*$");

    /**
     * Parses a .mgr file and returns a map of environment name (uppercase) → raw cfg file path.
     * Environment variable references like $DPLOAD, ${DPLOAD} are NOT expanded here —
     * call {@link #expandVars(String, Map)} after to do that.
     *
     * @param mgrPath absolute path to the .mgr file
     * @return map of envName (uppercase) → raw cfg file path (may contain $VAR tokens)
     */
    public static Map<String, String> parseEnvToCfgMap(Path mgrPath) {
        Map<String, String> result = new LinkedHashMap<>();
        if (mgrPath == null || !Files.exists(mgrPath)) {
            log.warn("[MgrConfigParser] .mgr file not found: {}", mgrPath);
            return result;
        }

        List<String> lines;
        try {
            lines = Files.readAllLines(mgrPath);
        } catch (IOException e) {
            log.error("[MgrConfigParser] Failed to read .mgr file: {}", mgrPath, e);
            return result;
        }

        int parsed = 0;
        for (String raw : lines) {
            String line = raw.trim();
            if (line.isEmpty() || line.startsWith("#")) continue;

            Matcher m = MGR_LINE_PATTERN.matcher(line);
            if (m.matches()) {
                String cfgRaw = m.group(1).trim();
                // group(2) = options (we don't use them here)
                String envName = m.group(3).trim().toUpperCase();
                result.put(envName, cfgRaw);
                parsed++;
                log.debug("[MgrConfigParser] Mapped env='{}' → cfg='{}'", envName, cfgRaw);
            } else {
                log.trace("[MgrConfigParser] Skipped unmatched line: {}", line);
            }
        }

        log.info("[MgrConfigParser] Parsed {} entries from {}", parsed, mgrPath);
        return result;
    }

    /**
     * Finds the cfg file path for the given environment name.
     * Returns null if not found.
     *
     * @param mgrPath   absolute path to the .mgr file
     * @param envName   environment name (case-insensitive)
     * @return raw cfg file path (may contain $VAR tokens), or null if not found
     */
    public static String findCfgForEnvironment(Path mgrPath, String envName) {
        if (envName == null) return null;
        Map<String, String> map = parseEnvToCfgMap(mgrPath);
        return map.get(envName.toUpperCase());
    }

    /**
     * Expands environment variable references in a path string.
     * Supports both $VAR and ${VAR} syntax.
     * Falls back to the actual OS environment variables.
     *
     * @param raw     path string potentially containing $VAR or ${VAR} tokens
     * @param overrides  additional variable overrides (e.g. from application config)
     * @return expanded path string
     */
    public static String expandVars(String raw, Map<String, String> overrides) {
        if (raw == null) return null;
        String result = raw;

        // Replace ${VAR} first
        Matcher m1 = Pattern.compile("\\$\\{([A-Za-z_][A-Za-z0-9_]*)\\}").matcher(result);
        StringBuffer sb = new StringBuffer();
        while (m1.find()) {
            String var = m1.group(1);
            String val = resolve(var, overrides);
            m1.appendReplacement(sb, Matcher.quoteReplacement(val != null ? val : m1.group(0)));
        }
        m1.appendTail(sb);
        result = sb.toString();

        // Then replace $VAR (word boundary)
        Matcher m2 = Pattern.compile("\\$([A-Za-z_][A-Za-z0-9_]*)").matcher(result);
        StringBuffer sb2 = new StringBuffer();
        while (m2.find()) {
            String var = m2.group(1);
            String val = resolve(var, overrides);
            m2.appendReplacement(sb2, Matcher.quoteReplacement(val != null ? val : m2.group(0)));
        }
        m2.appendTail(sb2);

        return sb2.toString();
    }

    private static String resolve(String var, Map<String, String> overrides) {
        if (overrides != null && overrides.containsKey(var)) {
            return overrides.get(var);
        }
        return System.getenv(var);
    }
}
