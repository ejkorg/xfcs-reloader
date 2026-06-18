package com.onsemi.cim.apps.exensio.xfcsreloader.service;

import com.onsemi.cim.apps.exensio.xfcsreloader.config.XfcsProperties;
import com.onsemi.cim.apps.exensio.xfcsreloader.web.dto.EnvConfCacheInfo;
import com.onsemi.cim.apps.exensio.xfcsreloader.web.dto.EnvYearRange;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.BufferedReader;
import java.io.StringReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Locale;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

@Service
public class EnvConfigService {
    private static final Logger log = LoggerFactory.getLogger(EnvConfigService.class);

    private final XfcsProperties xfcsProperties;
    private final SshClient sshClient;
    private final AtomicReference<CachedEnvConf> cache = new AtomicReference<>();
    private final Object refreshLock = new Object();
    private volatile String lastError;

    public EnvConfigService(XfcsProperties xfcsProperties, SshClient sshClient) {
        this.xfcsProperties = xfcsProperties;
        this.sshClient = sshClient;
    }

    public List<EnvYearRange> loadEnvs() {
        CachedEnvConf current = resolveEnvConf(false);
        if (current == null || current.rawText == null || current.rawText.isBlank()) {
            return List.of();
        }
        return parse(current.rawText);
    }

    public EnvConfCacheInfo getCacheInfo() {
        CachedEnvConf current = cache.get();
        long now = System.currentTimeMillis();
        long ttlMs = Math.max(1, xfcsProperties.getEnvConfCacheTtlSec()) * 1000L;

        if (current == null) {
            return new EnvConfCacheInfo(
                    xfcsProperties.isRemoteEnabled(),
                    "NONE",
                    xfcsProperties.getEnvConfCacheTtlSec(),
                    false,
                    -1,
                    null,
                    lastError,
                    0
            );
        }

        long age = now - current.fetchedAtEpochMs;
        boolean fresh = age <= ttlMs;
        int count = parse(current.rawText).size();

        return new EnvConfCacheInfo(
                xfcsProperties.isRemoteEnabled(),
                current.source,
                xfcsProperties.getEnvConfCacheTtlSec(),
                fresh,
                age,
                Instant.ofEpochMilli(current.fetchedAtEpochMs).toString(),
                lastError,
                count
        );
    }

    public EnvConfCacheInfo refreshNow() {
        resolveEnvConf(true);
        return getCacheInfo();
    }

    private CachedEnvConf resolveEnvConf(boolean forceRefresh) {
        long now = System.currentTimeMillis();
        long ttlMs = Math.max(1, xfcsProperties.getEnvConfCacheTtlSec()) * 1000L;
        CachedEnvConf existing = cache.get();
        if (!forceRefresh && existing != null && (now - existing.fetchedAtEpochMs) <= ttlMs) {
            return existing;
        }

        synchronized (refreshLock) {
            existing = cache.get();
            now = System.currentTimeMillis();
            if (!forceRefresh && existing != null && (now - existing.fetchedAtEpochMs) <= ttlMs) {
                return existing;
            }

            String localText = fetchLocal();
            if (localText != null && !localText.isBlank()) {
                CachedEnvConf updated = new CachedEnvConf(localText, "LOCAL", now);
                cache.set(updated);
                lastError = null;
                return updated;
            }

            String remoteText = fetchRemoteWithRetry();
            if (remoteText != null && !remoteText.isBlank()) {
                CachedEnvConf updated = new CachedEnvConf(remoteText, "REMOTE", now);
                cache.set(updated);
                return updated;
            }

            if (existing != null) {
                log.warn("Falling back to stale env.conf cache due to source read failures");
                return existing;
            }

            return null;
        }
    }

    private String fetchRemoteWithRetry() {
        if (!xfcsProperties.isRemoteEnabled()) {
            return null;
        }

        int retries = Math.max(0, xfcsProperties.getEnvConfRetries());
        int backoffMs = Math.max(0, xfcsProperties.getEnvConfRetryBackoffMs());

        for (int attempt = 0; attempt <= retries; attempt++) {
            try {
                return sshClient.readRemoteFile(
                        xfcsProperties.getRemoteHost(),
                        xfcsProperties.getRemotePort(),
                        xfcsProperties.getRemoteUser(),
                        xfcsProperties.getRemotePrivateKeyPath(),
                    xfcsProperties.getRemotePassword(),
                        xfcsProperties.getRemoteKnownHostsPath(),
                        xfcsProperties.isRemoteStrictHostKey(),
                        xfcsProperties.getRemoteConnectTimeoutMs(),
                        xfcsProperties.getRemoteReadTimeoutMs(),
                        xfcsProperties.getRemoteEnvConfPath()
                );
            } catch (Exception ex) {
                lastError = sanitizeError(ex.getMessage());
                log.warn("Remote env.conf read failed (attempt {}/{}): {}", attempt + 1, retries + 1, lastError);
                if (attempt < retries && backoffMs > 0) {
                    try {
                        Thread.sleep((long) backoffMs * (attempt + 1));
                    } catch (InterruptedException ie) {
                        Thread.currentThread().interrupt();
                        break;
                    }
                }
            }
        }
        return null;
    }

    private String fetchLocal() {
        try {
            String source = xfcsProperties.getEnvConfPath();
            if (source == null || source.isBlank()) {
                return null;
            }

            Path p = Path.of(source);
            if (!Files.exists(p)) {
                log.warn("Local env.conf file not found at expected path: {}", p.toAbsolutePath());
                return null;
            }
            
            String content = Files.readString(p, StandardCharsets.UTF_8);
            log.info("Successfully read env.conf from: {}", p.toAbsolutePath());
            return content;
        } catch (Exception ex) {
            lastError = sanitizeError(ex.getMessage());
            log.warn("Local env.conf read failed: {}", lastError);
            return null;
        }
    }

    private List<EnvYearRange> parse(String rawText) {
        List<EnvYearRange> out = new ArrayList<>();
        if (rawText == null || rawText.isBlank()) {
            return out;
        }

        try (BufferedReader reader = new BufferedReader(new StringReader(rawText))) {
            String line;
            while ((line = reader.readLine()) != null) {
                String t = line.trim();
                // Ignore empty lines, comments, and headers like [envs]
                if (t.isBlank() || t.startsWith("#") || t.startsWith("[")) {
                    continue;
                }

                // Expected format: szsort_wmap_sep=edbsz:2013:2016
                String[] eqParts = t.split("=");
                if (eqParts.length != 2) {
                    log.warn("Skipping env.conf line (expected exactly 1 '='): {}", t);
                    continue;
                }

                String environment = eqParts[0].trim();
                String[] rightParts = eqParts[1].trim().split(":");
                if (rightParts.length < 3) {
                    log.warn("Skipping env.conf line (expected 3 parts separated by ':' on the right): {}", t);
                    continue;
                }

                String dbCode = rightParts[0].trim();
                int yearStart = Integer.parseInt(rightParts[1].trim());
                int yearEnd = Integer.parseInt(rightParts[2].trim());

                // Derived codes used for UI filters and reload metadata.
                // Example: cpft_tmt => siteCode=CP, areaCode=FT, testerType=TMT
                String siteCode = "";
                String areaCode = "";
                String testerType = "";

                String siteName = null;
                String parentGroup = null;
                String regionGroup = null;
                String processGroup = "OTHERS";

                // Parse site/area/tester from environment naming (ported/approximated from the old backend logic).
                try {
                    String envLower = environment == null ? "" : environment.toLowerCase();
                    java.util.regex.Matcher m = java.util.regex.Pattern
                            .compile("^(cp|bk|sz)(ft|sort)_(.+)$")
                            .matcher(envLower);
                    if (m.matches()) {
                        siteCode = m.group(1).toUpperCase(Locale.ROOT);
                        areaCode = m.group(2).toUpperCase(Locale.ROOT);
                        testerType = m.group(3).toUpperCase(Locale.ROOT);
                    } else {
                        String[] parts = environment == null ? new String[0] : environment.split("_");
                        if (parts.length >= 3) {
                            siteCode = parts[0].toUpperCase(Locale.ROOT);
                            areaCode = parts[1].toUpperCase(Locale.ROOT);
                            testerType = String.join("_", java.util.Arrays.copyOfRange(parts, 2, parts.length))
                                    .toUpperCase(Locale.ROOT);
                        } else if (parts.length == 2) {
                            siteCode = parts[0].toUpperCase(Locale.ROOT);
                            areaCode = "";
                            testerType = parts[1].toUpperCase(Locale.ROOT);
                        } else if (parts.length == 1 && parts[0] != null) {
                            siteCode = parts[0].toUpperCase(Locale.ROOT);
                            areaCode = "";
                            testerType = "";
                        }
                    }
                } catch (Exception ignore) {
                    // Leave derived values as empty strings.
                }

                if ("edbfound".equalsIgnoreCase(dbCode)) {
                    String[] tokens = environment.split("_");
                    parentGroup = tokens.length > 0 ? tokens[0] : "";
                    regionGroup = tokens.length > 1 ? tokens[1].toUpperCase() : "";

                    if (environment.contains("_sort_")) {
                        processGroup = "PROBE";
                    } else if (environment.contains("_ft_")) {
                        processGroup = "FINAL TEST";
                    } else if (environment.contains("_et_")) {
                        processGroup = "PCM";
                    } else if (environment.contains("_epi_") || environment.contains("_fb5_") || environment.contains("_fb6_") || environment.contains("_fb8_")) {
                        processGroup = "WKS";
                    } else if (environment.contains("_rel_")) {
                        processGroup = "REL";
                    }
                } else {
                    switch (dbCode.toLowerCase()) {
                        case "edbme" -> siteName = "DIODES";
                        case "edbsz" -> siteName = "SUZHOU";
                        case "edbmt" -> siteName = "MountainTop";
                        case "edbbk" -> siteName = "BUCHEON";
                        case "edbcp" -> siteName = "CEBU";
                    }

                    String envLower = environment.toLowerCase();
                    boolean isProbe = false;
                    boolean isFT = false;
                    for (String pfx : new String[]{"bk", "sz", "me", "mt", "cp"}) {
                        if (envLower.startsWith(pfx + "sort")) {
                            isProbe = true; break;
                        }
                        if (envLower.startsWith(pfx + "ft")) {
                            isFT = true; break;
                        }
                    }

                    if (isProbe) {
                        processGroup = "PROBE";
                    } else if (isFT) {
                        processGroup = "FINAL TEST";
                    } else if (envLower.contains("et")) {
                        processGroup = "PCM";
                    } else if (envLower.contains("epi") || envLower.contains("fb5") || envLower.contains("fb6") || envLower.contains("fb8")) {
                        processGroup = "WKS";
                    } else if (envLower.contains("rel")) {
                        processGroup = "REL";
                    }
                }

                out.add(new EnvYearRange(
                        environment,
                        dbCode,
                        siteName,
                        siteCode,
                        areaCode,
                        testerType,
                        parentGroup,
                        regionGroup,
                        processGroup,
                        xfcsProperties.getArchivesRoot(),
                        yearStart,
                        yearEnd,
                        true
                ));
            }
        } catch (Exception ex) {
            lastError = sanitizeError(ex.getMessage());
            log.warn("Failed to parse env.conf: {}", lastError);
            return List.of();
        }

        return out;
    }

    private String sanitizeError(String message) {
        if (message == null) {
            return "unknown error";
        }
        return message.replaceAll("(?i)password\\s*=\\s*[^\\s]+", "password=***")
                .replaceAll("(?i)secret\\s*=\\s*[^\\s]+", "secret=***");
    }

    private record CachedEnvConf(String rawText, String source, long fetchedAtEpochMs) {
    }
}
