package com.onsemi.cim.apps.exensio.xfcsreloader.service;

import com.onsemi.cim.apps.exensio.xfcsreloader.entity.ReloadPendingFileEntity;
import com.onsemi.cim.apps.exensio.xfcsreloader.entity.ReloadSessionEntity;
import com.onsemi.cim.apps.exensio.xfcsreloader.entity.ReloadSessionEventEntity;
import com.onsemi.cim.apps.exensio.xfcsreloader.repository.ReloadPendingFileRepository;
import com.onsemi.cim.apps.exensio.xfcsreloader.repository.ReloadSessionEventRepository;
import com.onsemi.cim.apps.exensio.xfcsreloader.repository.ReloadSessionRepository;
import com.onsemi.cim.apps.exensio.xfcsreloader.web.dto.ReloadRequest;
import com.onsemi.cim.apps.exensio.xfcsreloader.web.dto.ReloadSessionEvent;import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.*;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.zip.GZIPInputStream;

/**
 * Handles asynchronous reload processing (staging only).
 *
 * <p>For each reload session:
 * <ol>
 *   <li>Resolves the destination inbox via {@link EnvFolderResolver}</li>
 *   <li>Creates a staging subfolder ({@code inbox/dearchive/})</li>
 *   <li>Copies the source archive file to the staging folder</li>
 *   <li>If the file is .gz, decompresses it in place</li>
 *   <li>Renames the file: strips MD5 hash, adds {@code _reloaded_yyyyMMddHHmmss} suffix</li>
 *   <li>Moves the file from staging to the inbox root (where ETL picks it up)</li>
 *   <li>Registers the file as pending for background ETL completion monitoring</li>
 * </ol>
 *
 * <p>All subsequent ETL monitoring is handled exclusively by {@link ReloadPendingMonitor}.
 */
@Service
public class ReloadExecutionService {

    private static final Logger log = LoggerFactory.getLogger(ReloadExecutionService.class);
    private static final DateTimeFormatter TS_FMT = DateTimeFormatter.ofPattern("yyyyMMddHHmmss");

    private final ReloadSessionRepository sessionRepository;
    private final ReloadSessionEventRepository eventRepository;
    private final ReloadPendingFileRepository pendingFileRepository;
    private final EnvFolderResolver envFolderResolver;
    private final SseEventBroker sseEventBroker;

    public ReloadExecutionService(ReloadSessionRepository sessionRepository,
                                  ReloadSessionEventRepository eventRepository,
                                  ReloadPendingFileRepository pendingFileRepository,
                                  EnvFolderResolver envFolderResolver,
                                  SseEventBroker sseEventBroker) {
        this.sessionRepository = sessionRepository;
        this.eventRepository = eventRepository;
        this.pendingFileRepository = pendingFileRepository;
        this.envFolderResolver = envFolderResolver;
        this.sseEventBroker = sseEventBroker;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Async reload processing
    // ──────────────────────────────────────────────────────────────────────────

    @Async("reloadTaskExecutor")
    @Transactional
    public void processSession(String sessionId, String actor, List<ReloadRequest.ReloadFileItem> files) {
        Optional<ReloadSessionEntity> sessionOpt = sessionRepository.findById(sessionId);
        if (sessionOpt.isEmpty()) {
            log.warn("[Reload] Session not found: {}", sessionId);
            return;
        }
        ReloadSessionEntity session = sessionOpt.get();
        String environment = session.getEnvironment();

        session.setStatus("processing");
        session.setMessage("Processing started");
        session.setStartedAt(Instant.now());
        sessionRepository.save(session);
        appendEvent(sessionId, "SESSION_STARTED", "Reload processing started for env: " + environment, actor, null);

        // Resolve inbox and staging folders via .mgr → .cfg chain
        Path inboxDir   = envFolderResolver.resolveInboxFolder(environment);
        Path stagingDir = envFolderResolver.resolveStagingFolder(environment);

        appendEvent(sessionId, "RESOLUTION_INFO",
                "inboxRoot=" + inboxDir + " | staging=" + stagingDir, actor, null);

        // Warn if we're using the dataRoot fallback — this means the environment
        // is not configured in the .mgr file and ETL may not be watching this path.
        EnvFolderResolver.EnvResolutionInfo resolution = envFolderResolver.resolveEnvDetails(environment);
        if (resolution == null) {
            log.warn("[Reload] WARNING: Environment '{}' not found in .mgr file. " +
                    "Using dataRoot fallback: {}. ETL may not be watching this path. " +
                    "Add this environment to the .mgr file to enable proper monitoring.",
                    environment, inboxDir);
            appendEvent(sessionId, "RESOLUTION_WARNING",
                    "WARNING: Environment '" + environment + "' not found in .mgr file. " +
                    "File placed at fallback path: " + inboxDir + ". " +
                    "ETL monitoring may not work correctly. " +
                    "Please add this environment to the .mgr file.",
                    actor, "ENV_NOT_IN_MGR");
        }

        try {
            Files.createDirectories(stagingDir);
        } catch (IOException e) {
            log.error("[Reload] Cannot create staging dir: {}", stagingDir, e);
            appendEvent(sessionId, "SESSION_FAILED", "Cannot create staging directory: " + stagingDir, actor, "STAGING_DIR_ERROR");
            session.setStatus("failed");
            session.setMessage("Failed to create staging directory");
            session.setCompletedAt(Instant.now());
            sessionRepository.save(session);
            sseEventBroker.complete(sessionId);
            return;
        }

        int failed = 0;
        int completed = 0;
        List<ReloadRequest.ReloadFileItem> inputs = files == null ? List.of() : files;
        boolean ftTmtContext = isFtTmtContext(session.getEnvironment(), session.getArea(), session.getTesterType());
        Map<String, String> pairedReloadSuffixByBase = ftTmtContext
            ? buildPairedReloadSuffixMap(inputs)
            : Map.of();

        for (ReloadRequest.ReloadFileItem item : inputs) {
            String rawPath = item.path();
            String userLotId = item.userLotId();
            if (rawPath == null || rawPath.isBlank()) continue;
            Path sourcePath = Path.of(rawPath);

            appendEvent(sessionId, "FILE_STARTED", "Processing: " + sourcePath.getFileName() + " (Lot: " + userLotId + ")", actor, null);

            if (!Files.exists(sourcePath) || !Files.isRegularFile(sourcePath)) {
                failed++;
                appendEvent(sessionId, "FILE_FAILED", "Source file not found: " + rawPath, actor, "FILE_NOT_FOUND");
                continue;
            }

            try {
                String pairSuffixOverride = resolvePairedSuffixOverride(sourcePath, ftTmtContext, pairedReloadSuffixByBase);
                Integer archiveYear = extractYear(sourcePath);
                Integer archiveMonth = extractMonth(sourcePath);
                String resultFileName = stageFile(sourcePath, stagingDir, inboxDir, sessionId, actor, environment, userLotId, pairSuffixOverride, archiveYear, archiveMonth);
                if (resultFileName != null) {
                    completed++;
                    appendEvent(sessionId, "FILE_COMPLETED", "Staged to inbox: " + resultFileName, actor, null);
                } else {
                    failed++;
                    appendEvent(sessionId, "FILE_FAILED", "Staging failed for: " + sourcePath.getFileName(), actor, "STAGE_FAILED");
                }
            } catch (Exception ex) {
                failed++;
                log.error("[Reload] Exception staging file: {}", rawPath, ex);
                appendEvent(sessionId, "FILE_FAILED", "Error staging: " + sourcePath.getFileName() + " — " + ex.getMessage(), actor, "PROCESSING_ERROR");
            }
        }

        // Session remains "processing" — ReloadPendingMonitor handles finalization after ETL
        session.setStatus("processing");
        session.setMessage("Staging completed (" + completed + " files). Waiting for ETL...");
        sessionRepository.save(session);

        appendEvent(sessionId, "BATCH_STAGED",
                "Staged " + completed + " of " + inputs.size() + " files. Monitoring for ETL completion.",
                actor, failed > 0 ? "PARTIAL_OR_FAILED" : null);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // File staging logic
    // ──────────────────────────────────────────────────────────────────────────

    private String stageFile(Path source, Path stagingDir, Path inboxDir,
                              String sessionId, String actor, String environment, String userLotId,
                              String suffixOverride, Integer archiveYear, Integer archiveMonth) throws IOException {
        String originalName = source.getFileName().toString();

        // 1. Copy source → staging
        Path stagingCopy = stagingDir.resolve(originalName);
        Files.copy(source, stagingCopy, StandardCopyOption.REPLACE_EXISTING);
        log.debug("[Reload] Copied {} → {}", source, stagingCopy);
        appendEvent(sessionId, "FILE_STAGED", "Copied to staging: " + stagingCopy, actor, null);

        Path currentFile = stagingCopy;

        // 2. Decompress .gz if needed
        if (originalName.toLowerCase().endsWith(".gz")) {
            String decompressedName = originalName.substring(0, originalName.length() - 3);
            Path decompressedPath = stagingDir.resolve(decompressedName);
            try (InputStream raw = Files.newInputStream(currentFile);
                 GZIPInputStream gz = new GZIPInputStream(raw)) {
                Files.copy(gz, decompressedPath, StandardCopyOption.REPLACE_EXISTING);
            }
            Files.deleteIfExists(currentFile);
            currentFile = decompressedPath;
            log.debug("[Reload] Decompressed → {}", currentFile);
            appendEvent(sessionId, "FILE_DECOMPRESSED", "Decompressed to: " + currentFile.getFileName(), actor, null);
        }

        // 3. Transform filename: strip _MD5-<hash>, add _reloaded_yyyyMMddHHmmss
        String transformedName = transformFilename(currentFile.getFileName().toString(), suffixOverride);
        Path renamedInStaging = stagingDir.resolve(transformedName);
        Files.move(currentFile, renamedInStaging, StandardCopyOption.REPLACE_EXISTING);
        currentFile = renamedInStaging;
        log.debug("[Reload] Renamed → {}", transformedName);

        // 4. Move from staging to inbox root
        Path finalTarget = inboxDir.resolve(transformedName);
        Files.move(currentFile, finalTarget, StandardCopyOption.REPLACE_EXISTING);
        log.info("[Reload] Placed in inbox: {}", finalTarget);
        appendEvent(sessionId, "file_copied_to_env", "Placed in inbox: " + finalTarget, actor, null);

        // 5. Register as pending for ETL completion monitor
        registerPending(finalTarget, inboxDir, sessionId, actor, environment, transformedName, originalName, userLotId, archiveYear, archiveMonth);

        return transformedName;
    }

    /**
     * Transforms a filename:
     * - Remove .gz suffix (if still present)
     * - Remove _MD5-[32 hex chars]
     * - Remove any existing _reloaded_yyyyMMddHHmmss pattern
     * - Insert _reloaded_yyyyMMddHHmmss before the last extension
     */
    static String transformFilename(String name) {
        return transformFilename(name, null);
    }

    static String transformFilename(String name, String suffixOverride) {
        String clean = name.replaceAll("\\.gz$", "");
        clean = clean.replaceAll("_MD5-[0-9a-fA-F]{32}", "");
        clean = clean.replaceAll("_reloaded_\\d{14}", "");

        String suffix = (suffixOverride == null || suffixOverride.isBlank())
                ? "_reloaded_" + LocalDateTime.now().format(TS_FMT)
                : suffixOverride;
        int lastDot = clean.lastIndexOf('.');
        if (lastDot > 0) {
            return clean.substring(0, lastDot) + suffix + clean.substring(lastDot);
        }
        return clean + suffix;
    }

    private Map<String, String> buildPairedReloadSuffixMap(List<ReloadRequest.ReloadFileItem> inputs) {
        Map<String, String> out = new HashMap<>();
        for (ReloadRequest.ReloadFileItem item : inputs) {
            if (item == null || item.path() == null || item.path().isBlank()) continue;
            Path sourcePath;
            try {
                sourcePath = Path.of(item.path());
            } catch (Exception ignored) {
                continue;
            }
            if (!isSpdLsrPairCandidate(sourcePath)) continue;

            String pairKey = buildPairKey(sourcePath.getFileName().toString());
            if (pairKey == null || pairKey.isBlank()) continue;

            out.computeIfAbsent(pairKey, k -> "_reloaded_" + LocalDateTime.now().format(TS_FMT));
        }
        return out;
    }

    private String resolvePairedSuffixOverride(Path sourcePath,
                                               boolean ftTmtContext,
                                               Map<String, String> pairedReloadSuffixByBase) {
        if (!ftTmtContext || sourcePath == null || pairedReloadSuffixByBase == null || pairedReloadSuffixByBase.isEmpty()) {
            return null;
        }
        if (!isSpdLsrPairCandidate(sourcePath)) return null;
        String pairKey = buildPairKey(sourcePath.getFileName().toString());
        if (pairKey == null || pairKey.isBlank()) return null;
        return pairedReloadSuffixByBase.get(pairKey);
    }

    private boolean isFtTmtContext(String environment, String area, String testerType) {
        String env = environment == null ? "" : environment.toLowerCase(Locale.ROOT);
        String areaNorm = area == null ? "" : area.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]", "");
        String tester = testerType == null ? "" : testerType.toLowerCase(Locale.ROOT);

        boolean envHasFtAndTmt = env.contains("ft") && env.contains("tmt");
        boolean areaIsFinalTest = areaNorm.contains("finaltest") || areaNorm.contains("finalt");
        boolean areaFtAndTesterTmt = areaNorm.contains("ft") && tester.contains("tmt");

        return envHasFtAndTmt || areaIsFinalTest || areaFtAndTesterTmt;
    }

    private boolean isSpdLsrPairCandidate(Path sourcePath) {
        if (sourcePath == null) return false;

        String fileName = sourcePath.getFileName() == null ? "" : sourcePath.getFileName().toString();
        String lower = fileName.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".gz")) {
            lower = lower.substring(0, lower.length() - 3);
        }
        return lower.endsWith(".lsr") || lower.endsWith(".spd");
    }

    private String buildPairKey(String fileName) {
        if (fileName == null || fileName.isBlank()) return null;
        String clean = fileName;
        if (clean.toLowerCase(Locale.ROOT).endsWith(".gz")) {
            clean = clean.substring(0, clean.length() - 3);
        }
        clean = clean.replaceAll("_MD5-[0-9a-fA-F]{32}", "");
        clean = clean.replaceAll("_reloaded_\\d{14}", "");

        int lastDot = clean.lastIndexOf('.');
        if (lastDot <= 0) return null;
        String ext = clean.substring(lastDot + 1).toLowerCase(Locale.ROOT);
        if (!"lsr".equals(ext) && !"spd".equals(ext)) return null;

        return clean.substring(0, lastDot).toLowerCase(Locale.ROOT);
    }

    /**
     * Registers a file in the pending_files table so ReloadPendingMonitor
     * can track its ETL progress (Processed/ vs NotProcessed/).
     */
    @Transactional
    public void registerPending(Path absPath, Path inboxRoot, String sessionId, String actor,
                                 String environment, String fileName, String originalFileName, String userLotId,
                                 Integer archiveYear, Integer archiveMonth) {
        try {
            ReloadPendingFileEntity pending = new ReloadPendingFileEntity();
            pending.setAbsPath(absPath.toString());
            pending.setSessionId(sessionId);
            pending.setRequester(actor);
            pending.setEnvironment(environment);
            pending.setFileName(fileName);
            pending.setOriginalFileName(originalFileName);
            pending.setInboxRoot(inboxRoot.toString());
            pending.setCreatedAt(Instant.now());
            pending.setUserLotId(userLotId);
            pending.setArchiveYear(archiveYear);
            pending.setArchiveMonth(archiveMonth);
            // file_status defaults to 'pending' via entity field initializer
            pendingFileRepository.saveAndFlush(pending);
            log.info("[Reload] Registered pending file: sessionId={} env={} file={} absPath={} archiveYear={} archiveMonth={}",
                    sessionId, environment, fileName, absPath, archiveYear, archiveMonth);
        } catch (Exception e) {
            log.warn("[Reload] Failed to register pending file {} (sessionId={}, env={}): {}",
                    absPath, sessionId, environment, e.getMessage(), e);
        }
    }

    private static Integer extractYear(Path path) {
        if (path == null) return null;
        for (Path part : path) {
            String v = part.toString();
            if (v.matches("20\\d{2}")) {
                return Integer.parseInt(v);
            }
        }
        return null;
    }

    private static Integer extractMonth(Path path) {
        if (path == null) return null;
        for (Path part : path) {
            String v = part.toString().toLowerCase(Locale.ROOT);
            if (v.matches("0?[1-9]|1[0-2]")) {
                return Integer.parseInt(v);
            }
            switch (v) {
                case "jan": case "january": return 1;
                case "feb": case "february": return 2;
                case "mar": case "march": return 3;
                case "apr": case "april": return 4;
                case "may": return 5;
                case "jun": case "june": return 6;
                case "jul": case "july": return 7;
                case "aug": case "august": return 8;
                case "sep": case "september": return 9;
                case "oct": case "october": return 10;
                case "nov": case "november": return 11;
                case "dec": case "december": return 12;
            }
        }
        return null;
    }


    // ──────────────────────────────────────────────────────────────────────────
    // Helpers
    // ──────────────────────────────────────────────────────────────────────────

    private void appendEvent(String sessionId, String type, String message, String actor, String errorCode) {
        try {
            ReloadSessionEventEntity entity = new ReloadSessionEventEntity();
            entity.setSessionId(sessionId);
            entity.setEventTime(Instant.now());
            entity.setEventType(type);
            entity.setMessage(message);
            entity.setActor(actor);
            entity.setErrorCode(errorCode);
            ReloadSessionEventEntity saved = eventRepository.save(entity);

            // Push to SSE subscribers
            ReloadSessionEvent dto = new ReloadSessionEvent(
                    saved.getId(), sessionId, saved.getEventTime(), type, message, actor, errorCode
            );
            sseEventBroker.publish(sessionId, dto);
        } catch (Exception e) {
            log.warn("[Reload] Failed to append event type={}: {}", type, e.getMessage());
        }
    }
}
