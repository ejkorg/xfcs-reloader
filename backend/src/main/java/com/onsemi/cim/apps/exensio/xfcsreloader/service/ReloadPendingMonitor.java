package com.onsemi.cim.apps.exensio.xfcsreloader.service;

import com.onsemi.cim.apps.exensio.xfcsreloader.config.XfcsProperties;
import com.onsemi.cim.apps.exensio.xfcsreloader.entity.ReloadPendingFileEntity;
import com.onsemi.cim.apps.exensio.xfcsreloader.entity.ReloadSessionEntity;
import com.onsemi.cim.apps.exensio.xfcsreloader.entity.ReloadSessionEventEntity;
import com.onsemi.cim.apps.exensio.xfcsreloader.repository.ReloadPendingFileRepository;
import com.onsemi.cim.apps.exensio.xfcsreloader.repository.ReloadSessionEventRepository;
import com.onsemi.cim.apps.exensio.xfcsreloader.repository.ReloadSessionRepository;
import com.onsemi.cim.apps.exensio.xfcsreloader.web.dto.ReloadSessionEvent;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import com.onsemi.cim.apps.exensio.xfcsreloader.service.exensio.BatchLookupResult;
import com.onsemi.cim.apps.exensio.xfcsreloader.service.exensio.ExensioClient;
import com.onsemi.cim.apps.exensio.xfcsreloader.service.exensio.ExensioPgcKeyResolver;
import com.onsemi.cim.apps.exensio.xfcsreloader.config.ExensioProperties;
import java.io.IOException;
import java.nio.file.*;
import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * Single authoritative component for all pending-file scanning, session finalization,
 * and stuck-session detection. Publishes every event to {@link SseEventBroker}.
 */
@Component
public class ReloadPendingMonitor {

    private static final Logger log = LoggerFactory.getLogger(ReloadPendingMonitor.class);

    private static final List<String> TERMINAL_STATUSES =
            List.of("completed", "failed", "partially_failed", "cancelled");

    /**
     * Statuses that indicate a file has cleared ETL pre-processing and is awaiting
     * Exensio confirmation. Includes the legacy {@code "exensio_loading"} value for
     * backward compatibility during rolling deployments.
     */
    static final Set<String> ETL_COMPLETE_STATUSES =
            Set.of("etl_complete", "exensio_loading");

    /**
     * Returns {@code true} when all files in the list have cleared ETL pre-processing —
     * i.e. none remain in {@code "pending"} or {@code "staging"} status.
     *
     * <p>An empty or null list returns {@code false}: the session either already
     * finished or has nothing to confirm.</p>
     *
     * @param sessionFiles files belonging to a single session
     * @return {@code true} iff the ETL fence is crossed for this session
     */
    static boolean isEtlFenceCrossed(List<ReloadPendingFileEntity> sessionFiles) {
        if (sessionFiles == null || sessionFiles.isEmpty()) return false;
        return sessionFiles.stream()
                .noneMatch(f -> "pending".equals(f.getFileStatus())
                             || "staging".equals(f.getFileStatus()));
    }

    private final ReloadSessionRepository sessionRepository;
    private final ReloadSessionEventRepository eventRepository;
    private final ReloadPendingFileRepository pendingFileRepository;
    private final SseEventBroker sseEventBroker;
    private final XfcsProperties xfcsProperties;
    private final EnvFolderResolver envFolderResolver;
    private final ScheduledExecutorService monitorExecutor;
    private final ExensioProperties exensioProperties;
    private final ExensioClient exensioClient;

    @Autowired(required = false)
    private PpLogQueryService ppLogQueryService;

    @Autowired(required = false)
    private ReloadSessionCompletionEmailService completionEmailService;

    public ReloadPendingMonitor(ReloadSessionRepository sessionRepository,
                                ReloadSessionEventRepository eventRepository,
                                ReloadPendingFileRepository pendingFileRepository,
                                SseEventBroker sseEventBroker,
                                XfcsProperties xfcsProperties,
                                EnvFolderResolver envFolderResolver,
                                ExensioProperties exensioProperties,
                                ExensioClient exensioClient) {
        this.sessionRepository = sessionRepository;
        this.eventRepository = eventRepository;
        this.pendingFileRepository = pendingFileRepository;
        this.sseEventBroker = sseEventBroker;
        this.xfcsProperties = xfcsProperties;
        this.envFolderResolver = envFolderResolver;
        this.exensioProperties = exensioProperties;
        this.exensioClient = exensioClient;
        this.monitorExecutor = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "xfcs-pending-monitor");
            t.setDaemon(true);
            return t;
        });
    }

    @PostConstruct
    public void init() {
        log.info("[PendingMonitor] Initialized. Background scanning active.");
        cleanupOrphanedPendingFiles();

        long intervalSec = Math.max(1, xfcsProperties.getPendingMonitorIntervalSec());
        log.info("[PendingMonitor] Starting monitor loop with interval={}s", intervalSec);
        monitorExecutor.scheduleWithFixedDelay(this::safeScanPendingFiles, intervalSec, intervalSec, TimeUnit.SECONDS);
    }

    @PreDestroy
    public void shutdown() {
        try {
            monitorExecutor.shutdownNow();
            log.info("[PendingMonitor] Monitor loop stopped.");
        } catch (Exception ignored) {
        }
    }

    private void safeScanPendingFiles() {
        try {
            scanPendingFiles();
        } catch (Exception e) {
            log.error("[PendingMonitor] Unhandled error in monitor loop: {}", e.getMessage(), e);
        }
    }

    /**
     * On startup, remove pending file entries for sessions that are already terminal,
     * then re-trigger the Exensio batch lookup for any session whose ETL fence was
     * crossed before the restart (all remaining files are in {@code etl_complete} /
     * {@code exensio_loading} state).
     */
    private void cleanupOrphanedPendingFiles() {
        try {
            List<ReloadPendingFileEntity> allPending = pendingFileRepository.findAll();
            if (allPending.isEmpty()) return;

            // Phase 1: drop pending rows that belong to already-terminal sessions.
            for (ReloadPendingFileEntity pf : allPending) {
                sessionRepository.findById(pf.getSessionId()).ifPresent(session -> {
                    String status = session.getStatus() == null ? "" : session.getStatus().toLowerCase();
                    if (TERMINAL_STATUSES.contains(status)) {
                        pendingFileRepository.deleteById(pf.getAbsPath());
                    }
                });
            }
            pendingFileRepository.flush();
            log.info("[PendingMonitor] Startup cleanup: removed orphaned pending entries for terminal sessions.");

            // Phase 2: re-trigger Exensio for sessions whose ETL fence was already
            // crossed before the restart (all files are in etl_complete / exensio_loading).
            if (exensioProperties.isEnabled()) {
                List<ReloadPendingFileEntity> stillPending = pendingFileRepository.findAll();
                Map<String, List<ReloadPendingFileEntity>> bySession =
                        stillPending.stream()
                                .collect(java.util.stream.Collectors.groupingBy(
                                        ReloadPendingFileEntity::getSessionId));

                for (Map.Entry<String, List<ReloadPendingFileEntity>> entry : bySession.entrySet()) {
                    String sessionId = entry.getKey();
                    List<ReloadPendingFileEntity> sessionFiles = entry.getValue();

                    if (!isEtlFenceCrossed(sessionFiles)) {
                        // Session still has pending/staging files — normal scan will handle them.
                        continue;
                    }

                    List<ReloadPendingFileEntity> etlComplete = sessionFiles.stream()
                            .filter(f -> ETL_COMPLETE_STATUSES.contains(f.getFileStatus()))
                            .toList();

                    if (etlComplete.isEmpty()) {
                        // Fence crossed but no etl_complete files (all failed/terminal) — nothing to do.
                        continue;
                    }

                    log.info("[PendingMonitor] Startup resume: session={} has {} etl_complete file(s) " +
                            "with ETL fence already crossed — re-triggering Exensio batch.",
                            sessionId, etlComplete.size());

                    Set<String> sessionsToFinalize = new HashSet<>();
                    int pgcKey = resolvePgcKeyForSession(sessionId);
                    triggerExensioForSession(sessionId, etlComplete, sessionsToFinalize, pgcKey);
                    for (String sid : sessionsToFinalize) {
                        finalizeSessionIfDone(sid);
                    }
                }
            }
        } catch (Exception e) {
            log.warn("[PendingMonitor] Startup cleanup failed: {}", e.getMessage());
        }
    }

    @Transactional
    public void scanPendingFiles() {
        try {
            List<ReloadPendingFileEntity> pending;
            try {
                pending = pendingFileRepository.findAll();
            } catch (Exception e) {
                log.warn("[PendingMonitor] Failed to query pending files: {}", e.getMessage());
                return;
            }

            if (pending.isEmpty()) {
                log.debug("[PendingMonitor] No pending files to scan.");
                try {
                    long activeSessions = sessionRepository.countByStatusNotIn(TERMINAL_STATUSES);
                    if (activeSessions > 0) {
                        log.warn("[PendingMonitor] No pending files found, but {} active sessions exist. " +
                                        "Pending registration may have failed or not committed.",
                                activeSessions);
                    }
                } catch (Exception ignored) {
                    // best-effort diagnostics only
                }
                checkStuckSessions();
                return;
            }
            log.info("[PendingMonitor] Scanning {} pending files...", pending.size());

            // Old backend parity: validate session existence in batch and drop orphaned pending rows.
            // This avoids endless scanning noise for stale rows whose parent session no longer exists.
            Set<String> sessionIds = new HashSet<>();
            for (ReloadPendingFileEntity pf : pending) {
                if (pf.getSessionId() != null && !pf.getSessionId().isBlank()) {
                    sessionIds.add(pf.getSessionId());
                }
            }
            Set<String> validSessionIds = new HashSet<>();
            if (!sessionIds.isEmpty()) {
                for (ReloadSessionEntity s : sessionRepository.findAllById(sessionIds)) {
                    if (s != null && s.getSessionId() != null) {
                        validSessionIds.add(s.getSessionId());
                    }
                }
            }

            List<String> toRemove = new ArrayList<>();
            Set<String> sessionsToFinalize = new HashSet<>();

            for (ReloadPendingFileEntity pf : pending) {
                try {
                    if (pf.getSessionId() == null || pf.getSessionId().isBlank() ||
                            !validSessionIds.contains(pf.getSessionId())) {
                        log.warn("[PendingMonitor] Dropping orphan pending entry: absPath={} sessionId={}",
                                pf.getAbsPath(), pf.getSessionId());
                        toRemove.add(pf.getAbsPath());
                        continue;
                    }

                    String fName = pf.getFileName();
                    String environment = pf.getEnvironment();

                    log.info("[PendingMonitor] Checking file: {} | env: {} | absPath: {}",
                            fName, environment, pf.getAbsPath());

                    // Resolve the env root at scan time (same as old backend).
                    // This ensures we always use the correct inbox path even if the DB
                    // stored a stale/fallback inboxRoot from before the SSH fix.
                    java.nio.file.Path envRoot = envFolderResolver.resolveInboxFolder(environment);
                    log.info("[PendingMonitor] Resolved env root for '{}': {}", environment, envRoot);

                    // Recursively search for the file from the env root (unlimited depth)
                    java.util.Optional<java.nio.file.Path> foundOpt = findFileRecursively(envRoot, fName);

                    if (foundOpt.isEmpty()) {
                        log.info("[PendingMonitor] File not found in env tree: {} (root={})", fName, envRoot);
                        continue;
                    }

                    java.nio.file.Path foundPath = foundOpt.get();
                    String foundStr = foundPath.toString().replace("\\", "/").toLowerCase();
                    String absPathLower = pf.getAbsPath() == null ? "" : pf.getAbsPath().replace("\\", "/").toLowerCase();

                    log.info("[PendingMonitor] Found: {}", foundPath);

                    if (foundStr.equals(absPathLower)) {
                        // Still at inbox root — staging
                        if (!"staging".equals(pf.getFileStatus())) {
                            pf.setFileStatus("staging");
                            pendingFileRepository.save(pf);
                        }
                        if (pf.getLastKnownPath() == null || !pf.getLastKnownPath().equals(foundPath.toString())) {
                            appendEvent(pf.getSessionId(), "file_staging",
                                    "Still staging (in inbox root): " + pf.getFileName() + " (Lot: " + pf.getUserLotId() + ")",
                                    pf.getRequester(), null);
                            pf.setLastKnownPath(foundPath.toString());
                            pendingFileRepository.save(pf);
                        }
                        continue;
                    }

                    if (foundStr.contains("/processed/") || foundStr.endsWith("/processed")) {
                        // Determine output destination from pp_log first (most reliable),
                        // falling back to outbox directory scanning.
                        String destination = null;

                        if (ppLogQueryService != null) {
                            try {
                                PpLogQueryService.PpLogResult ppResult = ppLogQueryService.queryByLotAndEnv(
                                        pf.getUserLotId(), pf.getEnvironment(), pf.getFileName());
                                if (ppResult != null && ppResult.destination() != null
                                        && !ppResult.destination().isBlank()
                                        && !"NOT_PROCESSED".equals(ppResult.destination())) {
                                    destination = ppResult.destination();
                                    log.debug("[PendingMonitor] Destination '{}' resolved via pp_log for: {}",
                                            destination, pf.getFileName());
                                }
                            } catch (Exception e) {
                                log.debug("[PendingMonitor] pp_log destination lookup failed for {}: {}",
                                        pf.getFileName(), e.getMessage());
                            }
                        }

                        if (destination == null) {
                            destination = detectDestinationFromOutbox(environment, pf.getFileName());
                        }

                        if (exensioProperties.isEnabled()) {
                            // Only transition to etl_complete once — avoid spamming events on every scan cycle.
                            // Also accept the legacy "exensio_loading" value so rolling deploys are seamless.
                            if (!ETL_COMPLETE_STATUSES.contains(pf.getFileStatus())) {
                                pf.setFileStatus("etl_complete");
                                pf.setDestinationFolder(destination);
                                pendingFileRepository.save(pf);

                                String schema = exensioProperties.resolvedDbschemaForDestination(destination);
                                String msg = buildEtlProcessedMsg(pf, destination, schema, true);
                                appendEvent(pf.getSessionId(), "file_etl_completed", msg, pf.getRequester(), null);

                                sessionRepository.findById(pf.getSessionId()).ifPresent(sess -> {
                                    if (!TERMINAL_STATUSES.contains(sess.getStatus() == null ? "" : sess.getStatus().toLowerCase())) {
                                        sess.setMessage("ETL complete. Awaiting Exensio confirmation...");
                                        sessionRepository.save(sess);
                                    }
                                });

                                log.info("[PendingMonitor] ETL completed for: {} | destination={} schema={}. Awaiting Exensio.",
                                        pf.getFileName(), destination, schema);
                            }
                            // Do not add to toRemove — wait for Exensio confirmation
                        } else {
                            pf.setFileStatus("completed");
                            pf.setResolvedAt(Instant.now());
                            pf.setDestinationFolder(destination);
                            pendingFileRepository.save(pf);

                            String schema = exensioProperties.resolvedDbschemaForDestination(destination);
                            String msg = buildEtlProcessedMsg(pf, destination, schema, false);
                            appendEvent(pf.getSessionId(), "file_completed", msg, pf.getRequester(), null);
                            log.info("[PendingMonitor] ETL completed for: {} (Lot: {}) | destination={}", pf.getFileName(), pf.getUserLotId(), destination);
                            toRemove.add(pf.getAbsPath());
                            sessionsToFinalize.add(pf.getSessionId());
                        }

                    } else if (foundStr.contains("/notprocessed/") || foundStr.endsWith("/notprocessed")) {
                        String errReason = null;
                        
                        // Try pp_log first if available
                        if (ppLogQueryService != null) {
                            PpLogQueryService.PpLogResult ppLogResult = ppLogQueryService.queryByLotAndEnv(
                                    pf.getUserLotId(), pf.getEnvironment(), pf.getFileName());
                            if (ppLogResult != null && ppLogResult.reason() != null && !ppLogResult.reason().isBlank()) {
                                errReason = ppLogResult.reason();
                                log.debug("[PendingMonitor] Got error reason from pp_log for {}: {}", pf.getFileName(), errReason);
                            }
                        }
                        
                        // Fall back to .err file if pp_log didn't provide a reason
                        if (errReason == null) {
                            errReason = tryReadErrReason(foundPath.toString());
                        }
                        
                        // If both pp_log and .err file failed, use generic message
                        if (errReason == null) {
                            errReason = "ETL rejected file. No detail available.";
                        }
                        
                        String msg = "ETL rejected (NotProcessed/): " + pf.getFileName() + " (Lot: " + pf.getUserLotId() + ") | Reason: " + errReason;

                        pf.setFileStatus("failed");
                        pf.setErrorReason(errReason);
                        pf.setResolvedAt(java.time.Instant.now());
                        pendingFileRepository.save(pf);

                        appendEvent(pf.getSessionId(), "file_failed", msg, pf.getRequester(), "ETL_NOT_PROCESSED", pf.getArchiveYear(), pf.getArchiveMonth());
                        log.warn("[PendingMonitor] ETL rejected file: {}", pf.getFileName());

                        toRemove.add(pf.getAbsPath());
                        sessionsToFinalize.add(pf.getSessionId());

                    } else if (foundStr.contains("/reworkfiles/") || foundStr.endsWith("/reworkfiles")) {
                        String errReason = "File issue. Check logs for details.";
                        String msg = "ETL sent file to ReworkFiles: " + pf.getFileName()
                                + " (Lot: " + pf.getUserLotId() + ") | Reason: " + errReason;

                        pf.setFileStatus("failed");
                        pf.setErrorReason(errReason);
                        pf.setResolvedAt(java.time.Instant.now());
                        pendingFileRepository.save(pf);

                        appendEvent(pf.getSessionId(), "file_failed", msg, pf.getRequester(), "ETL_REWORK_FILES", pf.getArchiveYear(), pf.getArchiveMonth());
                        log.warn("[PendingMonitor] ETL moved file to ReworkFiles: {}", pf.getFileName());

                        toRemove.add(pf.getAbsPath());
                        sessionsToFinalize.add(pf.getSessionId());

                    } else if (!foundPath.toString().equals(pf.getLastKnownPath())) {
                        appendEvent(pf.getSessionId(), "file_staging", "File moved to: " + foundPath, pf.getRequester(), null);
                        pf.setLastKnownPath(foundPath.toString());
                        pendingFileRepository.save(pf);
                    }
                } catch (Exception ex) {
                    log.warn("[PendingMonitor] Error scanning file '{}': {}", pf.getFileName(), ex.getMessage());
                }
            }

            if (!toRemove.isEmpty()) {
                for (String key : toRemove) {
                    pendingFileRepository.deleteById(key);
                }
                pendingFileRepository.flush();
            }

            // Per-session ETL fence check: after processing all files in this scan cycle,
            // group the remaining (non-removed) pending files by session and check whether
            // each session has crossed the ETL fence (no files remain in pending/staging).
            List<ReloadPendingFileEntity> stillPending = pendingFileRepository.findAll();
            Map<String, List<ReloadPendingFileEntity>> bySession =
                    stillPending.stream()
                            .collect(java.util.stream.Collectors.groupingBy(ReloadPendingFileEntity::getSessionId));

            for (Map.Entry<String, List<ReloadPendingFileEntity>> entry : bySession.entrySet()) {
                String sessionId = entry.getKey();
                List<ReloadPendingFileEntity> sessionFiles = entry.getValue();

                if (!isEtlFenceCrossed(sessionFiles)) {
                    // Some files still in pending/staging — keep scanning next cycle
                    continue;
                }

                List<ReloadPendingFileEntity> etlComplete = sessionFiles.stream()
                        .filter(f -> ETL_COMPLETE_STATUSES.contains(f.getFileStatus()))
                        .toList();

                if (etlComplete.isEmpty()) {
                    // All files reached terminal states (failed etc.) with no etl_complete rows —
                    // skip Exensio and let the session finalize directly.
                    sessionsToFinalize.add(sessionId);
                    continue;
                }

                if (exensioProperties.isEnabled()) {
                    int pgcKey = resolvePgcKeyForSession(sessionId);
                    triggerExensioForSession(sessionId, etlComplete, sessionsToFinalize, pgcKey);
                } else {
                    // Exensio disabled: promote all etl_complete files directly to completed.
                    for (ReloadPendingFileEntity pf : etlComplete) {
                        pf.setFileStatus("completed");
                        pf.setResolvedAt(Instant.now());
                        pendingFileRepository.save(pf);
                        String schema = exensioProperties.resolvedDbschemaForDestination(pf.getDestinationFolder());
                        appendEvent(pf.getSessionId(), "file_completed",
                                buildEtlProcessedMsg(pf, pf.getDestinationFolder(), schema, false),
                                pf.getRequester(), null);
                        toRemove.add(pf.getAbsPath());
                    }
                    // Delete the newly promoted rows
                    for (ReloadPendingFileEntity pf : etlComplete) {
                        pendingFileRepository.deleteById(pf.getAbsPath());
                    }
                    pendingFileRepository.flush();
                    sessionsToFinalize.add(sessionId);
                }
            }

            for (String sessionId : sessionsToFinalize) {
                finalizeSessionIfDone(sessionId);
            }

            checkStuckSessions();

        } catch (Exception e) {
            log.error("[PendingMonitor] Unhandled error in scanPendingFiles: {}", e.getMessage(), e);
        }
    }

    private void processExensioLoading(List<ReloadPendingFileEntity> batch, Set<String> sessionsToFinalize) {
        log.info("[PendingMonitor] Processing {} files waiting for Exensio confirmation", batch.size());
        try {
            List<BatchLookupResult.RecordUpdate> updates = exensioClient.lotWaferLookupBatch(batch);

            for (BatchLookupResult.RecordUpdate update : updates) {
                pendingFileRepository.findById(update.absPath()).ifPresent(pf -> {
                    boolean terminal = false;

                    switch (update.type()) {
                        case DONE -> {
                            pf.setFileStatus("completed");
                            pf.setResolvedAt(Instant.now());
                            pf.setExensioWaferKey(update.waferKey());
                            pf.setExensioPgKey(update.pgKey());
                            String dest = pf.getDestinationFolder() != null ? " [" + pf.getDestinationFolder() + "]" : "";
                            String msg = "Loaded in Exensio" + dest + ": " + pf.getFileName()
                                    + " (Lot: " + pf.getUserLotId() + ", pgKey=" + update.pgKey() + ")";
                            appendEvent(pf.getSessionId(), "file_completed", msg, pf.getRequester(), null, pf.getArchiveYear(), pf.getArchiveMonth());
                            log.info("[PendingMonitor] Exensio confirmed: {}", pf.getFileName());
                            terminal = true;
                        }
                        case NOT_FOUND -> {
                            long elapsed = Duration.between(pf.getCreatedAt(), Instant.now()).toMinutes();
                            if (elapsed >= exensioProperties.getTimeoutMinutes()) {
                                // ETL succeeded (file is in Processed/) but Exensio hasn't picked it up
                                // within the timeout window. Mark as unverified — not failed — because
                                // the ETL work itself completed. The user should verify manually.
                                pf.setFileStatus("unverified-exensio");
                                pf.setResolvedAt(Instant.now());
                                pf.setErrorReason("Not found in Exensio after " + exensioProperties.getTimeoutMinutes()
                                        + " min. ETL completed — please verify in Exensio manually.");
                                String msg = "ETL complete but not yet confirmed in Exensio: " + pf.getFileName()
                                        + " (Lot: " + pf.getUserLotId() + ")"
                                        + " | Destination: " + (pf.getDestinationFolder() != null ? pf.getDestinationFolder() : "unknown")
                                        + " | Please verify in Exensio manually.";
                                appendEvent(pf.getSessionId(), "file_unverified", msg, pf.getRequester(), "EXENSIO_NOT_FOUND", pf.getArchiveYear(), pf.getArchiveMonth());
                                log.warn("[PendingMonitor] Exensio timeout for: {} — marking unverified", pf.getFileName());
                                terminal = true;
                            }
                        }
                        case ERROR -> {
                            long elapsed = Duration.between(pf.getCreatedAt(), Instant.now()).toMinutes();
                            if (elapsed >= exensioProperties.getTimeoutMinutes()) {
                                // Exensio API is unavailable or erroring. The ETL completed
                                // successfully — don't penalise the user with a failed status.
                                // Mark unverified and ask for manual verification.
                                pf.setFileStatus("unverified-exensio");
                                pf.setResolvedAt(Instant.now());
                                pf.setErrorReason("Exensio API error: " + update.errorMessage()
                                        + ". ETL completed — please verify in Exensio manually.");
                                String msg = "ETL complete but Exensio API check failed: " + pf.getFileName()
                                        + " (Lot: " + pf.getUserLotId() + ")"
                                        + " | Destination: " + (pf.getDestinationFolder() != null ? pf.getDestinationFolder() : "unknown")
                                        + " | API error: " + update.errorMessage()
                                        + " | Please verify in Exensio manually.";
                                appendEvent(pf.getSessionId(), "file_unverified", msg, pf.getRequester(), "EXENSIO_API_ERROR", pf.getArchiveYear(), pf.getArchiveMonth());
                                log.warn("[PendingMonitor] Exensio API error for: {} — marking unverified", pf.getFileName());
                                terminal = true;
                            }
                        }
                    }

                    if (terminal) {
                        pendingFileRepository.save(pf);
                        pendingFileRepository.deleteById(pf.getAbsPath());
                        sessionsToFinalize.add(pf.getSessionId());
                    }
                });
            }
            pendingFileRepository.flush();
        } catch (Exception e) {
            log.error("[PendingMonitor] Error processing Exensio loading batch: {}", e.getMessage(), e);
        }
    }

    /**
     * Fires a single Exensio batch lookup for one session after its ETL fence is crossed.
     *
     * <p>Receives only the {@code etl_complete} (or legacy {@code exensio_loading}) files
     * for this specific session. The DONE/NOT_FOUND/ERROR handling is identical to
     * {@link #processExensioLoading} — the key difference is that this method operates
     * on a single session's files rather than a cross-session accumulation.</p>
     *
     * <p>After processing, all resolved rows are deleted from the staging table and the
     * session id is added to {@code sessionsToFinalize} so the caller can finalize the
     * session in the same scan cycle.</p>
     *
     * @param sessionId        the session being confirmed
     * @param etlCompleteFiles files for this session with status {@code etl_complete} or
     *                         {@code exensio_loading}
     * @param sessionsToFinalize mutable set that collects session ids ready for finalization
     * @param pgcKey           program-group-class key derived from the session's area/testerType
     */
    void triggerExensioForSession(String sessionId,
                                  List<ReloadPendingFileEntity> etlCompleteFiles,
                                  Set<String> sessionsToFinalize,
                                  int pgcKey) {
        log.info("[PendingMonitor] Triggering Exensio batch for session={} ({} files, pgc_key={})",
                sessionId, etlCompleteFiles.size(), pgcKey);
        try {
            // Best-effort: fill in missing destinationFolder from pp_log before calling Exensio.
            // This covers files that transitioned to etl_complete before pp_log was wired in,
            // or where detectDestinationFromOutbox() returned null on the first scan cycle.
            if (ppLogQueryService != null) {
                for (ReloadPendingFileEntity pf : etlCompleteFiles) {
                    if (pf.getDestinationFolder() != null) continue;
                    try {
                        PpLogQueryService.PpLogResult ppResult = ppLogQueryService.queryByLotAndEnv(
                                pf.getUserLotId(), pf.getEnvironment(), pf.getFileName());
                        if (ppResult != null && ppResult.destination() != null
                                && !ppResult.destination().isBlank()
                                && !"NOT_PROCESSED".equals(ppResult.destination())) {
                            pf.setDestinationFolder(ppResult.destination());
                            pendingFileRepository.save(pf);
                            log.info("[PendingMonitor] Late-resolved destination='{}' via pp_log for: {}",
                                    ppResult.destination(), pf.getFileName());
                        }
                    } catch (Exception e) {
                        log.debug("[PendingMonitor] pp_log late-resolve failed for {}: {}",
                                pf.getFileName(), e.getMessage());
                    }
                }
            }

            List<BatchLookupResult.RecordUpdate> updates =
                    exensioClient.lotWaferLookupBatch(etlCompleteFiles, pgcKey);

            for (BatchLookupResult.RecordUpdate update : updates) {
                pendingFileRepository.findById(update.absPath()).ifPresent(pf -> {
                    boolean terminal = false;

                    switch (update.type()) {
                        case DONE -> {
                            pf.setFileStatus("completed");
                            pf.setResolvedAt(Instant.now());
                            pf.setExensioWaferKey(update.waferKey());
                            pf.setExensioPgKey(update.pgKey());
                            String dest = pf.getDestinationFolder() != null
                                    ? " [" + pf.getDestinationFolder() + "]" : "";
                            String msg = "Loaded in Exensio" + dest + ": " + pf.getFileName()
                                    + " (Lot: " + pf.getUserLotId() + ", pgKey=" + update.pgKey() + ")";
                            appendEvent(pf.getSessionId(), "file_completed", msg, pf.getRequester(), null, pf.getArchiveYear(), pf.getArchiveMonth());
                            log.info("[PendingMonitor] Exensio confirmed (session={}): {}", sessionId, pf.getFileName());
                            terminal = true;
                        }
                        case NOT_FOUND -> {
                            long elapsed = Duration.between(pf.getCreatedAt(), Instant.now()).toMinutes();
                            if (elapsed >= exensioProperties.getTimeoutMinutes()) {
                                pf.setFileStatus("unverified-exensio");
                                pf.setResolvedAt(Instant.now());
                                pf.setErrorReason("Not found in Exensio after "
                                        + exensioProperties.getTimeoutMinutes()
                                        + " min. ETL completed — please verify in Exensio manually.");
                                String msg = "ETL complete but not yet confirmed in Exensio: " + pf.getFileName()
                                        + " (Lot: " + pf.getUserLotId() + ")"
                                        + " | Destination: " + (pf.getDestinationFolder() != null
                                                ? pf.getDestinationFolder() : "unknown")
                                        + " | Please verify in Exensio manually.";
                                appendEvent(pf.getSessionId(), "file_unverified", msg, pf.getRequester(), "EXENSIO_NOT_FOUND", pf.getArchiveYear(), pf.getArchiveMonth());
                                log.warn("[PendingMonitor] Exensio timeout (session={}): {} — marking unverified",
                                        sessionId, pf.getFileName());
                                terminal = true;
                            }
                        }
                        case ERROR -> {
                            long elapsed = Duration.between(pf.getCreatedAt(), Instant.now()).toMinutes();
                            if (elapsed >= exensioProperties.getTimeoutMinutes()) {
                                pf.setFileStatus("unverified-exensio");
                                pf.setResolvedAt(Instant.now());
                                pf.setErrorReason("Exensio API error: " + update.errorMessage()
                                        + ". ETL completed — please verify in Exensio manually.");
                                String msg = "ETL complete but Exensio API check failed: " + pf.getFileName()
                                        + " (Lot: " + pf.getUserLotId() + ")"
                                        + " | Destination: " + (pf.getDestinationFolder() != null
                                                ? pf.getDestinationFolder() : "unknown")
                                        + " | API error: " + update.errorMessage()
                                        + " | Please verify in Exensio manually.";
                                appendEvent(pf.getSessionId(), "file_unverified", msg, pf.getRequester(), "EXENSIO_API_ERROR", pf.getArchiveYear(), pf.getArchiveMonth());
                                log.warn("[PendingMonitor] Exensio API error (session={}): {} — marking unverified",
                                        sessionId, pf.getFileName());
                                terminal = true;
                            }
                        }
                    }

                    if (terminal) {
                        pendingFileRepository.save(pf);
                        pendingFileRepository.deleteById(pf.getAbsPath());
                        sessionsToFinalize.add(pf.getSessionId());
                    }
                });
            }
            pendingFileRepository.flush();
        } catch (Exception e) {
            log.error("[PendingMonitor] Error in triggerExensioForSession (session={}): {}",
                    sessionId, e.getMessage(), e);
        }
    }

    /**
     * Recursively searches for a file by exact name from the given root directory.
     * Same approach as the old backend's findFileRecursively().
     */
    private java.util.Optional<java.nio.file.Path> findFileRecursively(java.nio.file.Path rootDir, String fileName) {
        if (rootDir == null || fileName == null || !java.nio.file.Files.exists(rootDir)) {
            return java.util.Optional.empty();
        }
        try {
            return java.nio.file.Files.find(rootDir, Integer.MAX_VALUE,
                    (path, attrs) -> attrs.isRegularFile() && path.getFileName().toString().equals(fileName))
                    .findFirst();
        } catch (Exception e) {
            log.debug("[PendingMonitor] findFileRecursively error in '{}': {}", rootDir, e.getMessage());
            return java.util.Optional.empty();
        }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // PGC-key resolution
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * Resolves the Exensio {@code pgc_key} for a session from its area/testerType,
     * defaulting to Final Test (2) when the session is missing or has no area.
     */
    private int resolvePgcKeyForSession(String sessionId) {
        if (sessionId == null) {
            return ExensioPgcKeyResolver.PGC_KEY_FT;
        }
        return sessionRepository.findById(sessionId)
                .map(s -> ExensioPgcKeyResolver.resolve(s.getArea(), s.getTesterType()))
                .orElse(ExensioPgcKeyResolver.PGC_KEY_FT);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Stuck-session detection
    // ──────────────────────────────────────────────────────────────────────────

    void checkStuckSessions() {
        int timeoutMin = xfcsProperties.getStuckSessionTimeoutMin();
        if (timeoutMin <= 0) return;

        Instant cutoff = Instant.now().minusSeconds((long) timeoutMin * 60);
        try {
            List<ReloadSessionEntity> nonTerminal = sessionRepository.findAll().stream()
                    .filter(s -> !TERMINAL_STATUSES.contains(
                            s.getStatus() == null ? "" : s.getStatus().toLowerCase()))
                    .filter(s -> s.getCreatedAt() != null && s.getCreatedAt().isBefore(cutoff))
                    .toList();

            for (ReloadSessionEntity session : nonTerminal) {
                String sessionId = session.getSessionId();
                log.warn("[PendingMonitor] Stuck session detected: {} (created {})", sessionId, session.getCreatedAt());

                session.setStatus("failed");
                session.setCompletedAt(Instant.now());
                session.setMessage("Session timed out after " + timeoutMin + " minutes with no ETL resolution");
                sessionRepository.save(session);

                appendEvent(sessionId, "SESSION_TIMED_OUT",
                        "Session automatically failed: no ETL resolution within " + timeoutMin + " minutes",
                        "SYSTEM", "STUCK_SESSION_TIMEOUT");

                // Remove all pending files for this session
                List<ReloadPendingFileEntity> stuckFiles = pendingFileRepository.findBySessionId(sessionId);
                for (ReloadPendingFileEntity pf : stuckFiles) {
                    pendingFileRepository.deleteById(pf.getAbsPath());
                }
                if (!stuckFiles.isEmpty()) {
                    pendingFileRepository.flush();
                }

                sseEventBroker.complete(sessionId);

                if (completionEmailService != null) {
                    completionEmailService.notifyIfTerminal(sessionId);
                }
            }
        } catch (Exception e) {
            log.error("[PendingMonitor] Error in checkStuckSessions: {}", e.getMessage(), e);
        }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Session finalization
    // ──────────────────────────────────────────────────────────────────────────

    private void finalizeSessionIfDone(String sessionId) {
        sessionRepository.findById(sessionId).ifPresent(session -> {
            long remaining = pendingFileRepository.countBySessionId(sessionId);
            if (remaining == 0) {
                List<ReloadSessionEventEntity> events = eventRepository.findBySessionId(sessionId);
                boolean hasFailure    = events.stream().anyMatch(e -> "file_failed".equalsIgnoreCase(e.getEventType()));
                boolean hasCompleted  = events.stream().anyMatch(e -> "file_completed".equalsIgnoreCase(e.getEventType()));
                boolean hasUnverified = events.stream().anyMatch(e -> "file_unverified".equalsIgnoreCase(e.getEventType()));

                String finalStatus;
                String finalMessage;
                if (hasFailure && (hasCompleted || hasUnverified)) {
                    finalStatus  = "partially_failed";
                    finalMessage = "Completed with partial failures";
                } else if (hasFailure) {
                    finalStatus  = "failed";
                    finalMessage = "Completed with failures";
                } else if (hasUnverified) {
                    // ETL succeeded for all files but some could not be confirmed in Exensio.
                    // Treat as completed with a warning — not failed.
                    finalStatus  = "completed";
                    finalMessage = "ETL complete. Some files could not be verified in Exensio — please verify manually.";
                } else {
                    finalStatus  = "completed";
                    finalMessage = "All files processed successfully";
                }

                session.setStatus(finalStatus);
                session.setCompletedAt(Instant.now());
                session.setMessage(finalMessage);
                sessionRepository.save(session);

                appendEvent(sessionId, session.getStatus().toUpperCase(), session.getMessage(), "SYSTEM", null);
                log.info("[PendingMonitor] Session {} finalized as {}", sessionId, session.getStatus());

                sseEventBroker.complete(sessionId);

                if (completionEmailService != null) {
                    completionEmailService.notifyIfTerminal(sessionId);
                }
            }
        });
    }


    // ──────────────────────────────────────────────────────────────────────────
    // File search helpers
    // ──────────────────────────────────────────────────────────────────────────

    private String tryReadErrReason(String foundAbsolutePath) {
        try {
            Path foundPath = Path.of(foundAbsolutePath);
            String fileName = foundPath.getFileName().toString();

            Path errPath = foundPath.resolveSibling(fileName + ".err");
            if (!Files.exists(errPath) || !Files.isRegularFile(errPath)) {
                Path errPathUpper = foundPath.resolveSibling(fileName + ".ERR");
                if (Files.exists(errPathUpper) && Files.isRegularFile(errPathUpper)) {
                    return readErrText(errPathUpper);
                }
                return null;
            }
            return readErrText(errPath);
        } catch (Exception ignored) {}
        return null;
    }

    private String readErrText(Path errPath) {
        try {
            String txt = Files.readString(errPath);
            if (txt == null) return null;
            txt = txt.trim();
            if (txt.isEmpty()) return null;

            String[] lines = txt.split("\\r?\\n");
            String firstNonEmpty = null;

            // Prefer the most meaningful ETL reason line.
            for (String line : lines) {
                if (line == null) continue;
                String t = line.trim();
                if (t.isEmpty()) continue;
                if (firstNonEmpty == null) firstNonEmpty = t;

                String extracted = extractStructuredErrReason(t);
                if (extracted != null && !extracted.isBlank()) {
                    return truncateReason(extracted);
                }

                if (isLikelyHumanReason(t)) {
                    return truncateReason(t);
                }
            }

            return firstNonEmpty == null ? null : truncateReason(firstNonEmpty);
        } catch (Exception ignored) {
            return null;
        }
    }

    /**
     * Parses common ETL tabular error rows like:
     * 1  9001  E  0  0  NO_WAFERID indicated inside the file
     */
    private String extractStructuredErrReason(String line) {
        if (line == null || line.isBlank()) return null;
        String compact = line.trim();

        // Ignore pure counters/headers like "2 0".
        if (compact.matches("^[0-9\\s]+$")) return null;

        // Ignore stacktrace continuation lines.
        String lower = compact.toLowerCase(Locale.ROOT);
        if (lower.startsWith("at ") || lower.contains(" called at ")) return null;

        // Attempt to capture trailing message after fixed numeric/status columns.
        java.util.regex.Matcher m = java.util.regex.Pattern
                .compile("^\\d+\\s+\\d+\\s+[A-Za-z]\\s+\\d+\\s+\\d+\\s+(.+)$")
                .matcher(compact);
        if (m.find()) {
            String reason = m.group(1).trim();
            return reason.isBlank() ? null : reason;
        }

        return null;
    }

    private boolean isLikelyHumanReason(String line) {
        if (line == null || line.isBlank()) return false;
        String lower = line.toLowerCase(Locale.ROOT);

        if (line.matches("^[0-9\\s]+$")) return false;
        if (lower.startsWith("at ") || lower.contains(" called at ")) return false;

        // Typical meaningful indicators from ETL outputs.
        return lower.contains("error")
                || lower.contains("failed")
                || lower.contains("invalid")
                || lower.contains("no_")
                || lower.contains("missing")
                || lower.contains("inside the file")
                || lower.contains("reason");
    }

    private String truncateReason(String value) {
        if (value == null) return null;
        String trimmed = value.trim();
        if (trimmed.length() <= 500) return trimmed;
        return trimmed.substring(0, 500) + "...";
    }

    /**
     * Determines PRODUCTION or SANDBOX destination by looking in the --out directory
     * (from the .cfg file for this environment) for an output file whose name contains
     * the input filename stem (lot id portion before any extension).
     *
     * The ETL writes output files to:
     *   outboxPath/PRODUCTION/<outputFile>   or
     *   outboxPath/SANDBOX/<outputFile>
     *
     * We find which sub-folder has a file whose name includes the input file's stem.
     * Falls back to null if the outbox path is unknown or neither folder has a match.
     */
    private String detectDestinationFromOutbox(String environment, String inputFileName) {
        if (environment == null || inputFileName == null) return null;

        EnvFolderResolver.EnvResolutionInfo res = envFolderResolver.resolveEnvDetails(environment);
        if (res == null || res.outboxPath() == null || res.outboxPath().isBlank()) {
            log.debug("[PendingMonitor] No --out path in .cfg for env='{}', cannot detect destination", environment);
            return null;
        }

        String outbox = res.outboxPath().replace("\\", "/");
        // Strip any trailing file-extension from the input name to get the stem for matching
        // e.g. P002924307_FT_reloaded_20260620000911.LSR → P002924307_FT_reloaded_20260620000911
        String stem = inputFileName;
        int dotIdx = stem.lastIndexOf('.');
        if (dotIdx > 0) stem = stem.substring(0, dotIdx);

        for (String schema : List.of("PRODUCTION", "SANDBOX")) {
            java.nio.file.Path schemaDir = java.nio.file.Paths.get(outbox, schema);
            if (!java.nio.file.Files.isDirectory(schemaDir)) continue;
            try {
                final String stemFinal = stem;
                boolean found = java.nio.file.Files.list(schemaDir)
                        .anyMatch(p -> p.getFileName().toString().contains(stemFinal));
                if (found) {
                    log.info("[PendingMonitor] Detected destination='{}' for '{}' via outbox={}", schema, inputFileName, schemaDir);
                    return schema;
                }
            } catch (Exception e) {
                log.debug("[PendingMonitor] Error scanning outbox dir '{}': {}", schemaDir, e.getMessage());
            }
        }

        log.debug("[PendingMonitor] No output file found for '{}' in outbox PRODUCTION/SANDBOX dirs under '{}'", inputFileName, outbox);
        return null;
    }

    /**
     * Builds the event message for a file that has been ETL-processed (landed in Processed/).
     * Always includes the destination schema so the UI can display it.
     */
    private String buildEtlProcessedMsg(ReloadPendingFileEntity pf, String destination, String schema, boolean awaitingExensio) {
        StringBuilder sb = new StringBuilder();
        sb.append("ETL processed (Processed/): ").append(pf.getFileName())
          .append(" (Lot: ").append(pf.getUserLotId()).append(")");
        if (destination != null) {
            sb.append(" | Destination: ").append(destination);
        }
        if (schema != null) {
            sb.append(" | Schema: ").append(schema);
        }
        if (awaitingExensio) {
            sb.append(" | Awaiting Exensio confirmation");
        }
        return sb.toString();
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Event helpers
    // ──────────────────────────────────────────────────────────────────────────

    private void appendEvent(String sessionId, String type, String message, String actor, String errorCode) {
        appendEvent(sessionId, type, message, actor, errorCode, null, null);
    }

    private void appendEvent(String sessionId, String type, String message, String actor, String errorCode, Integer archiveYear, Integer archiveMonth) {
        try {
            ReloadSessionEventEntity entity = new ReloadSessionEventEntity();
            entity.setSessionId(sessionId);
            entity.setEventTime(Instant.now());
            entity.setEventType(type);
            entity.setMessage(message);
            entity.setActor(actor);
            entity.setErrorCode(errorCode);
            entity.setArchiveYear(archiveYear);
            entity.setArchiveMonth(archiveMonth);
            ReloadSessionEventEntity saved = eventRepository.save(entity);

            // Push to SSE subscribers
            ReloadSessionEvent dto = new ReloadSessionEvent(
                    saved.getId(), sessionId, saved.getEventTime(), type, message, actor, errorCode
            );
            sseEventBroker.publish(sessionId, dto);
        } catch (Exception ignored) {}
    }
}
