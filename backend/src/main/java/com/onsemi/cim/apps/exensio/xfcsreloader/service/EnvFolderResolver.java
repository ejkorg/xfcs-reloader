package com.onsemi.cim.apps.exensio.xfcsreloader.service;

import com.onsemi.cim.apps.exensio.xfcsreloader.config.XfcsProperties;
import com.onsemi.cim.apps.exensio.xfcsreloader.util.CfgFileParser;
import com.onsemi.cim.apps.exensio.xfcsreloader.util.MgrConfigParser;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Resolves an environment name to its inbox folder by following the chain:
 *   envs.mgr  →  .cfg file  →  inbox path
 *
 * Resolution chain:
 *   1. Read mgrFilePath (.mgr file) to find the .cfg file for the environment
 *   2. Read the .cfg file to extract the raw inbox path (first colon-delimited field)
 *   3. Expand environment variables ($DPDATA, $DPLOAD, etc.)
 *   4. Strip processing suffixes (/Processed, /NotProcessed, /dearchive)
 *   5. Cache the result in a ConcurrentHashMap
 *
 * The resolved inbox path is where ETL picks up files. The staging folder is a
 * subdirectory within the inbox (e.g. inbox/dearchive/).
 */
@Service
public class EnvFolderResolver {

    private static final Logger log = LoggerFactory.getLogger(EnvFolderResolver.class);

    private final XfcsProperties props;
    private final SshClient sshClient;

    // Cache: envName (uppercase) → resolution info
    private final ConcurrentHashMap<String, EnvResolutionInfo> cache = new ConcurrentHashMap<>();

    public EnvFolderResolver(XfcsProperties props, SshClient sshClient) {
        this.props = props;
        this.sshClient = sshClient;
    }

    @PostConstruct
    public void init() {
        log.info("[EnvFolderResolver] Initialized. mgrFilePath={}, mgrReadMode={}",
                props.getMgrFilePath(), props.getMgrReadMode());
    }

    /**
     * Result of resolving an environment's folders.
     */
    public record EnvResolutionInfo(
            /** Absolute path to the .cfg file used for this environment. */
            String cfgFilePath,
            /**
             * Resolved base inbox path (env vars expanded, processing suffixes stripped).
             * Files should be copied to: inboxPath / stagingFolder / filename
             */
            String inboxPath,
            /**
             * Raw inbox path as written in the .cfg file (may contain $VAR tokens and
             * processing suffixes such as /Processed). Useful for display / debugging.
             */
            String rawInboxPath,
            /** Outbox (archive) path from --out flag (may be null). */
            String outboxPath,
            /** ETL log path from --log option in .cfg line (may be null). */
            String logPath,
            /** Location code from --loc flag (e.g. "CP"). May be null. */
            String locationCode,
            /** How this info was resolved: "LOCAL", "REMOTE", or "FALLBACK". */
            String configSource,
            /** Total files in inbox at time of resolution (-1 if not checked). */
            int inboxFileCount
    ) {
        // Compact constructor for backward compat
        public EnvResolutionInfo(String cfgFilePath, String inboxPath, int inboxFileCount) {
            this(cfgFilePath, inboxPath, null, null, null, null, "LOCAL", inboxFileCount);
        }
    }

    private record MgrEntry(String cfgPath, String options, String envName) {}

    /**
     * Resolves the environment's inbox folder, using cache if available.
     *
     * @param envName environment name (case-insensitive)
     * @return EnvResolutionInfo, or null if resolution fails (env not in .mgr, .cfg not found, etc.)
     */
    public EnvResolutionInfo resolveEnvDetails(String envName) {
        if (envName == null || envName.isBlank()) return null;
        String key = envName.toUpperCase();

        // Return cached result if present
        EnvResolutionInfo cached = cache.get(key);
        if (cached != null) {
            log.debug("[EnvFolderResolver] Cache hit for env='{}'", envName);
            return cached;
        }

        EnvResolutionInfo resolved = doResolve(envName);
        if (resolved != null) {
            cache.put(key, resolved);
        }
        return resolved;
    }

    /**
     * Invalidates the cache entry for a specific environment.
     */
    public void invalidateCache(String envName) {
        if (envName != null) {
            cache.remove(envName.toUpperCase());
        }
    }

    /**
     * Clears the entire resolution cache.
     */
    public void clearCache() {
        cache.clear();
        log.info("[EnvFolderResolver] Resolution cache cleared.");
    }

    /**
     * Resolves the staging destination folder for copying files.
     * This is: resolvedInboxPath / stagingFolder (e.g. inbox/dearchive)
     *
     * @param envName environment name
     * @return the staging Path, or a fallback based on dataRoot if resolution fails
     */
    public Path resolveStagingFolder(String envName) {
        EnvResolutionInfo info = resolveEnvDetails(envName);
        String stagingFolder = props.getStagingFolder() != null ? props.getStagingFolder() : "dearchive";

        if (info != null && info.inboxPath() != null && !info.inboxPath().isBlank()) {
            return Paths.get(info.inboxPath()).resolve(stagingFolder);
        }

        // Fallback: dataRoot / envName / stagingFolder
        log.warn("[EnvFolderResolver] Could not resolve inbox for '{}', using dataRoot fallback.", envName);
        return Paths.get(props.getDataRoot()).resolve(envName).resolve(stagingFolder);
    }

    /**
     * Resolves the final inbox root folder (where ETL picks up processed files).
     *
     * @param envName environment name
     * @return the inbox Path, or fallback based on dataRoot
     */
    public Path resolveInboxFolder(String envName) {
        EnvResolutionInfo info = resolveEnvDetails(envName);

        if (info != null && info.inboxPath() != null && !info.inboxPath().isBlank()) {
            return Paths.get(info.inboxPath());
        }

        // Fallback: dataRoot / envName
        log.warn("[EnvFolderResolver] Could not resolve inbox for '{}', using dataRoot fallback.", envName);
        return Paths.get(props.getDataRoot()).resolve(envName);
    }

    // ──────────────────────────────────────────────────────────────────────────────
    // Private resolution logic
    // ──────────────────────────────────────────────────────────────────────────────

    private EnvResolutionInfo doResolve(String envName) {
        String mgrFilePath = props.getMgrFilePath();
        if (mgrFilePath == null || mgrFilePath.isBlank()) {
            log.warn("[EnvFolderResolver] No mgrFilePath configured.");
            return null;
        }

        // Build env var overrides from configured property names
        Map<String, String> envVarOverrides = buildEnvVarOverrides();

        // Expand any $VAR tokens in the configured mgrFilePath itself
        String expandedMgrPath = MgrConfigParser.expandVars(mgrFilePath, envVarOverrides);

        // Read .mgr file content — LOCAL or REMOTE via SSH
        List<String> mgrLines = readMgrLines(expandedMgrPath);
        if (mgrLines == null || mgrLines.isEmpty()) {
            log.warn("[EnvFolderResolver] Could not read .mgr file: {}", expandedMgrPath);
            return null;
        }

        // Step 1: Find the .cfg file path for this environment from the .mgr lines
        MgrEntry mgrEntry = findMgrEntryInLines(mgrLines, envName);
        if (mgrEntry == null || mgrEntry.cfgPath() == null || mgrEntry.cfgPath().isBlank()) {
            log.warn("[EnvFolderResolver] Environment '{}' not found in .mgr file: {}", envName, expandedMgrPath);
            return null;
        }
        String rawCfgPath = mgrEntry.cfgPath();

        // Step 2: Expand env vars in the cfg path
        String expandedCfgPath = MgrConfigParser.expandVars(rawCfgPath, envVarOverrides);

        // Step 3: Read .cfg file content — LOCAL or REMOTE via SSH
        String cfgContent = readCfgContent(expandedCfgPath);
        if (cfgContent == null || cfgContent.isBlank()) {
            log.warn("[EnvFolderResolver] Failed to read .cfg file for env='{}': {}", envName, expandedCfgPath);
            return null;
        }

        // Step 4: Parse the .cfg content
        CfgFileParser.CfgInfo cfgInfo = CfgFileParser.parseContent(cfgContent, envVarOverrides);
        if (cfgInfo == null) {
            log.warn("[EnvFolderResolver] Failed to parse .cfg content for env='{}': {}", envName, expandedCfgPath);
            return null;
        }

        log.info("[EnvFolderResolver] Resolved env='{}': cfg='{}', inboxPath='{}', outbox='{}'",
                envName, expandedCfgPath, cfgInfo.normalizedInboxPath(), cfgInfo.expandedOutboxPath());

        return new EnvResolutionInfo(
                expandedCfgPath,
                cfgInfo.normalizedInboxPath(),
                cfgInfo.rawInboxPath(),
                cfgInfo.expandedOutboxPath(),
                cfgInfo.expandedLogPath(),
                cfgInfo.locationCode(),
                "REMOTE".equalsIgnoreCase(props.getMgrReadMode()) ? "REMOTE" : "LOCAL",
                -1
        );
    }

    /**
     * Reads .mgr file lines — locally or via SSH depending on mgrReadMode.
     */
    private List<String> readMgrLines(String mgrFilePath) {
        if ("REMOTE".equalsIgnoreCase(props.getMgrReadMode())) {
            try {
                log.info("[EnvFolderResolver] Reading .mgr file via SSH: {}", mgrFilePath);
                String content = sshClient.readRemoteFile(
                        props.getRemoteHost(), props.getRemotePort(), props.getRemoteUser(),
                        props.getRemotePrivateKeyPath(), props.getRemotePassword(),
                        props.getRemoteKnownHostsPath(), props.isRemoteStrictHostKey(),
                        props.getRemoteConnectTimeoutMs(), props.getRemoteReadTimeoutMs(),
                        mgrFilePath
                );
                if (content != null && !content.isBlank()) {
                    return Arrays.asList(content.split("\\r?\\n"));
                }
                log.warn("[EnvFolderResolver] SSH read of .mgr returned empty content: {}", mgrFilePath);
            } catch (Exception e) {
                log.warn("[EnvFolderResolver] SSH read of .mgr failed: {}. Trying local fallback.", e.getMessage());
            }
        }
        // LOCAL read
        Path mgrPath = Path.of(mgrFilePath);
        if (!Files.exists(mgrPath)) {
            log.warn("[EnvFolderResolver] Local .mgr file not found: {}", mgrPath);
            return null;
        }
        try {
            List<String> lines = Files.readAllLines(mgrPath);
            log.info("[EnvFolderResolver] Read {} lines from local .mgr: {}", lines.size(), mgrPath);
            return lines;
        } catch (Exception e) {
            log.error("[EnvFolderResolver] Failed to read local .mgr file: {}", mgrPath, e);
            return null;
        }
    }

    /**
     * Reads .cfg file content — locally or via SSH depending on cfgReadMode.
     */
    private String readCfgContent(String cfgFilePath) {
        if ("REMOTE".equalsIgnoreCase(props.getCfgReadMode())) {
            try {
                log.info("[EnvFolderResolver] Reading .cfg file via SSH: {}", cfgFilePath);
                String content = sshClient.readRemoteFile(
                        props.getRemoteHost(), props.getRemotePort(), props.getRemoteUser(),
                        props.getRemotePrivateKeyPath(), props.getRemotePassword(),
                        props.getRemoteKnownHostsPath(), props.isRemoteStrictHostKey(),
                        props.getRemoteConnectTimeoutMs(), props.getRemoteReadTimeoutMs(),
                        cfgFilePath
                );
                if (content != null && !content.isBlank()) return content;
                log.warn("[EnvFolderResolver] SSH read of .cfg returned empty: {}", cfgFilePath);
            } catch (Exception e) {
                log.warn("[EnvFolderResolver] SSH read of .cfg failed: {}. Trying local fallback.", e.getMessage());
            }
        }
        // LOCAL read
        Path cfgPath = Path.of(cfgFilePath);
        if (!Files.exists(cfgPath)) {
            log.warn("[EnvFolderResolver] Local .cfg file not found: {}", cfgPath);
            return null;
        }
        try {
            return Files.readString(cfgPath);
        } catch (Exception e) {
            log.error("[EnvFolderResolver] Failed to read local .cfg file: {}", cfgPath, e);
            return null;
        }
    }

    /**
     * Finds the .cfg path for the given environment name in the already-read .mgr lines.
     * .mgr format: <cfg_path> : <options> : <env_name>
     *
     * Uses split(":", 3) so the env name is always parts[2], even when the options
     * section contains colons (e.g. $DPLOG/fcs_pp.log paths).
     * Also falls back to fuzzy filename matching (same technique as old backend).
     */
    private MgrEntry findMgrEntryInLines(List<String> lines, String envName) {
        String searchUpper = envName.toUpperCase();

        // Pass 1: exact match on 3rd column (parts[2] after split limit 3)
        for (String raw : lines) {
            String line = raw.trim();
            if (line.isEmpty() || line.startsWith("#")) continue;
            String[] parts = line.split(":", 3);
            if (parts.length >= 3) {
                String cfgPath = parts[0].trim();
                String options = parts[1].trim();
                String explicitEnv = parts[2].trim().toUpperCase();
                if (!cfgPath.isEmpty() && searchUpper.equals(explicitEnv)) {
                    log.debug("[EnvFolderResolver] Exact .mgr match for '{}': {}", envName, cfgPath);
                    return new MgrEntry(cfgPath, options, explicitEnv);
                }
            }
        }

        // Pass 2: fuzzy match — extract env name from .cfg filename stem
        // e.g. fcs_pp_szft_eagle.cfg → szft_eagle
        for (String raw : lines) {
            String line = raw.trim();
            if (line.isEmpty() || line.startsWith("#")) continue;
            String[] parts = line.split(":", 3);
            if (parts.length >= 1) {
                String cfgPath = parts[0].trim();
                String options = parts.length >= 2 ? parts[1].trim() : "";
                String explicitEnv = parts.length >= 3 ? parts[2].trim() : "";
                if (cfgPath.isEmpty()) continue;
                String fileName = Path.of(cfgPath).getFileName().toString().toLowerCase();
                // Strip common prefixes and .cfg extension
                String stem = fileName
                        .replaceAll("^fcs_pp_", "")
                        .replaceAll("^fcs_", "")
                        .replaceAll("^pp_", "")
                        .replaceAll("\\.cfg$", "");
                if (stem.equals(envName.toLowerCase())) {
                    log.debug("[EnvFolderResolver] Fuzzy .mgr match for '{}': {}", envName, cfgPath);
                    return new MgrEntry(cfgPath, options, explicitEnv);
                }
            }
        }
        return null;
    }

    /**
     * Builds a map of env variable overrides from XfcsProperties configuration.
     * These values substitute OS-level env vars when expanding $DPDATA, $DPLOAD, etc.
     *
     * When cfgReadMode=REMOTE, the JVM process on the app server does not have the
     * remote user's environment variables (DPLOAD, DPDATA, etc.) in its own env.
     * In that case we resolve them by running "echo $VAR" on the remote host via SSH.
     */
    private Map<String, String> buildEnvVarOverrides() {
        Map<String, String> overrides = new HashMap<>();

        boolean useRemote = "REMOTE".equalsIgnoreCase(props.getCfgReadMode())
                || "REMOTE".equalsIgnoreCase(props.getMgrReadMode());

        if (useRemote) {
            // Resolve env vars from the remote host where the .cfg files actually live
            resolveRemoteEnvVar(overrides, props.getDploadEnvVar());
            resolveRemoteEnvVar(overrides, props.getDpdataEnvVar());
            resolveRemoteEnvVar(overrides, props.getDpscriptEnvVar());
            resolveRemoteEnvVar(overrides, props.getDplogEnvVar());
        }

        // Fall back to local JVM env vars for any that weren't resolved remotely
        addIfAbsent(overrides, props.getDpdataEnvVar(), System.getenv(props.getDpdataEnvVar()));
        addIfAbsent(overrides, props.getDploadEnvVar(), System.getenv(props.getDploadEnvVar()));
        addIfAbsent(overrides, props.getDpscriptEnvVar(), System.getenv(props.getDpscriptEnvVar()));
        addIfAbsent(overrides, props.getDplogEnvVar(), System.getenv(props.getDplogEnvVar()));

        // Also support the dataRoot as DPDATA fallback if env var not set
        if (!overrides.containsKey(props.getDpdataEnvVar()) && props.getDataRoot() != null) {
            // Derive DPDATA from dataRoot: dataRoot is typically $DPDATA/data, so DPDATA = parent
            String dataRoot = props.getDataRoot();
            Path dataRootPath = Paths.get(dataRoot);
            // If dataRoot ends with "data", use its parent as DPDATA
            if ("data".equals(dataRootPath.getFileName().toString())) {
                overrides.put(props.getDpdataEnvVar(), dataRootPath.getParent().toString().replace("\\", "/"));
            } else {
                overrides.put(props.getDpdataEnvVar(), dataRoot.replace("\\", "/"));
            }
            log.debug("[EnvFolderResolver] Using dataRoot-derived DPDATA fallback: {}", overrides.get(props.getDpdataEnvVar()));
        }

        return overrides;
    }

    /**
     * Resolves a single environment variable from the remote host.
     *
     * Uses "bash -l -c 'echo $VAR'" to force a login shell so that .bash_profile /
     * .profile is sourced — non-interactive SSH exec sessions do NOT source those
     * files, so a plain "echo $DPLOAD" returns empty even when the variable is set
     * for the user's interactive sessions.
     *
     * Only adds to the map if the result is non-blank. Failures are logged and silently ignored.
     */
    private void resolveRemoteEnvVar(Map<String, String> overrides, String varName) {
        if (varName == null || varName.isBlank()) return;
        // Skip if already resolved (e.g. from a previous call)
        if (overrides.containsKey(varName)) return;
        try {
            // bash -l forces login shell → sources .bash_profile → $DPLOAD etc. are set
            String cmd = "bash -l -c 'echo $" + varName + "'";
            String result = sshClient.runRemoteCommand(
                    props.getRemoteHost(), props.getRemotePort(), props.getRemoteUser(),
                    props.getRemotePrivateKeyPath(), props.getRemotePassword(),
                    props.getRemoteKnownHostsPath(), props.isRemoteStrictHostKey(),
                    props.getRemoteConnectTimeoutMs(), props.getRemoteReadTimeoutMs(),
                    cmd
            );
            if (result != null) {
                String trimmed = result.trim();
                if (!trimmed.isBlank()) {
                    overrides.put(varName, trimmed);
                    log.debug("[EnvFolderResolver] Resolved remote env var {}={}", varName, trimmed);
                } else {
                    log.warn("[EnvFolderResolver] Remote env var '{}' resolved to empty string (not set in remote profile?)", varName);
                }
            }
        } catch (Exception e) {
            log.warn("[EnvFolderResolver] Could not resolve remote env var '{}': {}", varName, e.getMessage());
        }
    }

    private void addIfSet(Map<String, String> map, String key, String value) {
        if (key != null && !key.isBlank() && value != null && !value.isBlank()) {
            map.put(key, value);
        }
    }

    private void addIfAbsent(Map<String, String> map, String key, String value) {
        if (key != null && !key.isBlank() && value != null && !value.isBlank()) {
            map.putIfAbsent(key, value);
        }
    }
}
