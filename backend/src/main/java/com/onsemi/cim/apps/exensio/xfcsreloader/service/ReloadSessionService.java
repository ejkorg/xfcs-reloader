package com.onsemi.cim.apps.exensio.xfcsreloader.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.onsemi.cim.apps.exensio.xfcsreloader.config.XfcsProperties;
import com.onsemi.cim.apps.exensio.xfcsreloader.entity.ReloadSessionEntity;
import com.onsemi.cim.apps.exensio.xfcsreloader.entity.ReloadSessionEventEntity;
import com.onsemi.cim.apps.exensio.xfcsreloader.repository.ReloadPendingFileRepository;
import com.onsemi.cim.apps.exensio.xfcsreloader.repository.ReloadSessionEventRepository;
import com.onsemi.cim.apps.exensio.xfcsreloader.repository.ReloadSessionRepository;
import com.onsemi.cim.apps.exensio.xfcsreloader.web.dto.FileCoveragePoint;
import com.onsemi.cim.apps.exensio.xfcsreloader.web.dto.FileStatusDto;
import com.onsemi.cim.apps.exensio.xfcsreloader.web.dto.ReloadRequest;
import com.onsemi.cim.apps.exensio.xfcsreloader.web.dto.ReloadSessionEvent;
import com.onsemi.cim.apps.exensio.xfcsreloader.web.dto.ReloadStatus;
import com.onsemi.cim.apps.exensio.xfcsreloader.util.FilenameParser;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import jakarta.persistence.Query;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.*;

@Service
public class ReloadSessionService {
    private static final Logger log = LoggerFactory.getLogger(ReloadSessionService.class);

    /** Exception thrown when cancel is attempted on a terminal session. */
    public static class SessionAlreadyTerminalException extends RuntimeException {
        public SessionAlreadyTerminalException(String sessionId) {
            super("Session " + sessionId + " is already in a terminal state");
        }
    }

    private static final List<String> TERMINAL_STATUSES =
            List.of("completed", "failed", "partially_failed", "cancelled");
 
    private final ReloadSessionRepository reloadSessionRepository;
    private final ReloadSessionEventRepository reloadSessionEventRepository;
    private final ReloadPendingFileRepository reloadPendingFileRepository;
    private final ReloadExecutionService reloadExecutionService;
    private final SseEventBroker sseEventBroker;
    private final ObjectMapper objectMapper;
    private final EnvFolderResolver envFolderResolver;
    private final SshClient sshClient;
    private final XfcsProperties xfcsProperties;
    private final PpLogQueryService ppLogQueryService;

    @PersistenceContext
    private EntityManager entityManager;

    @Autowired
    public ReloadSessionService(ReloadSessionRepository reloadSessionRepository,
                                ReloadSessionEventRepository reloadSessionEventRepository,
                                ReloadPendingFileRepository reloadPendingFileRepository,
                                ReloadExecutionService reloadExecutionService,
                                SseEventBroker sseEventBroker,
                                ObjectMapper objectMapper,
                                EnvFolderResolver envFolderResolver,
                                SshClient sshClient,
                                XfcsProperties xfcsProperties,
                                @Autowired(required = false) PpLogQueryService ppLogQueryService) {
        this.reloadSessionRepository = reloadSessionRepository;
        this.reloadSessionEventRepository = reloadSessionEventRepository;
        this.reloadPendingFileRepository = reloadPendingFileRepository;
        this.reloadExecutionService = reloadExecutionService;
        this.sseEventBroker = sseEventBroker;
        this.objectMapper = objectMapper;
        this.envFolderResolver = envFolderResolver;
        this.sshClient = sshClient;
        this.xfcsProperties = xfcsProperties;
        this.ppLogQueryService = ppLogQueryService;
    }

    /**
     * Backward-compatible constructor used by tests and legacy call sites.
     * Advanced destination enrichment dependencies are optional for these scenarios.
     */
    public ReloadSessionService(ReloadSessionRepository reloadSessionRepository,
                                ReloadSessionEventRepository reloadSessionEventRepository,
                                ReloadPendingFileRepository reloadPendingFileRepository,
                                ReloadExecutionService reloadExecutionService,
                                SseEventBroker sseEventBroker,
                                ObjectMapper objectMapper) {
        this(
                reloadSessionRepository,
                reloadSessionEventRepository,
                reloadPendingFileRepository,
                reloadExecutionService,
                sseEventBroker,
                objectMapper,
                null,
                null,
                new XfcsProperties(),
                null
        );
    }

    @Transactional
    public String create(ReloadRequest request, String requester) {
        String id = UUID.randomUUID().toString();
        int total = request.files() != null ? request.files().size() : (request.filePaths() != null ? request.filePaths().size() : 0);
        Instant now = Instant.now();

        ReloadSessionEntity entity = new ReloadSessionEntity();
        entity.setSessionId(id);
        entity.setRequester(requester);
        entity.setEnvironment(request.environment());
        entity.setSite(request.site());
        entity.setArea(request.area());
        entity.setTesterType(request.testerType());
        entity.setStatus("created");
        entity.setMessage("Reload session created");
        entity.setFileCount(total);
        entity.setTotalBytes(0L);
        entity.setCreatedAt(now);
        entity.setStartedAt(now);
        entity.setCompletedAt(null);
        entity.setDetails(toDetailsJson(request));

        reloadSessionRepository.save(entity);
        appendEvent(id, "SESSION_CREATED", "Reload session created", requester, null);
        // NOTE: Do NOT call processSession here! The @Async method runs in a new thread
        // and won't see this session because this transaction hasn't committed yet.
        // The controller dispatches processSession AFTER this transaction commits.
        return id;
    }

    /**
     * Dispatches async processing for a session.
     * Called from the controller AFTER the create() transaction commits,
     * ensuring the async thread can find the session entity in the DB.
     */
    public void dispatchProcessing(String sessionId, String requester, List<ReloadRequest.ReloadFileItem> files) {
        reloadExecutionService.processSession(sessionId, requester, files);
    }

    @Transactional(readOnly = true)
    public ReloadStatus getStatus(String sessionId) {
        Optional<ReloadSessionEntity> session = reloadSessionRepository.findById(sessionId);
        if (session.isEmpty()) {
            return new ReloadStatus(sessionId, "unknown", "Session not found", null, null, null, null, 0, 0, 0, Collections.emptyList(), Collections.emptyList());
        }
        return toDto(session.get());
    }

    @Transactional(readOnly = true)
    public List<ReloadSessionEvent> getEvents(String sessionId) {
        return reloadSessionEventRepository.findBySessionIdOrderByEventTimeAsc(sessionId)
                .stream()
                .map(this::toEventDto)
                .toList();
    }

    @Transactional(readOnly = true)
    public List<FileStatusDto> getSessionFiles(String sessionId) {
        Optional<ReloadSessionEntity> sessionOpt = reloadSessionRepository.findById(sessionId);
        if (sessionOpt.isEmpty()) {
            return Collections.emptyList();
        }

        // 1) Build rows only from files that were actually tracked for this session
        // (pending table and/or per-session events). This excludes request-only files
        // that never got copied/staged.
        Map<String, MutableFileStatus> byPath = new LinkedHashMap<>();
        ReloadSessionEntity session = sessionOpt.get();
        // 2) Overlay live pending table rows (authoritative while still in-flight).
        for (var pf : reloadPendingFileRepository.findBySessionId(sessionId)) {
            String absPath = pf.getAbsPath();
            MutableFileStatus m = byPath.computeIfAbsent(absPath,
                    k -> MutableFileStatus.pending(k, pf.getFileName(), pf.getUserLotId()));

            if (pf.getFileName() != null && !pf.getFileName().isBlank()) m.fileName = pf.getFileName();
            if (pf.getOriginalFileName() != null && !pf.getOriginalFileName().isBlank()) m.originalFileName = pf.getOriginalFileName();
            if (pf.getUserLotId() != null && !pf.getUserLotId().isBlank()) m.userLotId = pf.getUserLotId();
            if (pf.getFileStatus() != null && !pf.getFileStatus().isBlank()) m.fileStatus = pf.getFileStatus();
            if (pf.getErrorReason() != null && !pf.getErrorReason().isBlank()) m.errorReason = pf.getErrorReason();
            if (pf.getLastKnownPath() != null && !pf.getLastKnownPath().isBlank()) {
                m.resolvedPath = pf.getLastKnownPath();
            }
            // Prefer the persisted destinationFolder from the entity (set by ReloadPendingMonitor);
            // fall back to re-deriving from lastKnownPath for rows that pre-date the column.
            if (pf.getDestinationFolder() != null) {
                m.destinationFolder = pf.getDestinationFolder();
            } else if (pf.getLastKnownPath() != null && !pf.getLastKnownPath().isBlank()) {
                m.destinationFolder = detectDestinationFolder(pf.getLastKnownPath());
            }
            if (pf.getCreatedAt() != null) m.createdAt = pf.getCreatedAt();
            if (pf.getResolvedAt() != null) m.resolvedAt = pf.getResolvedAt();
        }

        // 3) Overlay terminal info from events so completed/failed sessions are not shown as processing.
        List<ReloadSessionEventEntity> events = reloadSessionEventRepository.findBySessionIdOrderByEventTimeAsc(sessionId);
        for (ReloadSessionEventEntity ev : events) {
            String rawEventType = ev.getEventType() == null ? "" : ev.getEventType().trim();
            String eventType = rawEventType.toLowerCase(Locale.ROOT);
            if (!("file_completed".equals(eventType) || "file_failed".equals(eventType)
                    || "file_staging".equals(eventType) || "file_etl_completed".equals(eventType)
                    || "file_unverified".equals(eventType))) {
                continue;
            }

            String message = ev.getMessage() == null ? "" : ev.getMessage();
            String fileName = extractFileNameFromEventMessage(message);
            if (fileName == null || fileName.isBlank()) {
                continue;
            }

            MutableFileStatus target = findByFileName(byPath, fileName);
            if (target == null) {
                String syntheticPath = fileName;
                target = MutableFileStatus.pending(syntheticPath, fileName, null);
                byPath.put(syntheticPath, target);
            } else if (fileName != null && !fileName.isBlank()) {
                // Prefer ETL/runtime filename over original archive filename for display.
                target.fileName = fileName;
            }

            String derivedStatus = switch (eventType) {
                case "file_completed" -> {
                    // Distinguish execution-stage FILE_COMPLETED (staged to inbox) from
                    // ETL-resolution file_completed (terminal complete).
                    if ("FILE_COMPLETED".equals(rawEventType)) {
                        yield "staging";
                    }
                    yield "completed";
                }
                case "file_failed"      -> "failed";
                case "file_unverified"  -> "unverified-exensio";
                case "file_staging"     -> "staging";
                case "file_etl_completed" -> "etl_complete";
                default -> target.fileStatus;
            };

            // Monotonic progression: prevent regressions like completed -> staging
            // when events share close timestamps or arrive out of order.
            if (statusRank(derivedStatus) >= statusRank(target.fileStatus)) {
                target.fileStatus = derivedStatus;
            }

            if ("file_failed".equals(eventType)) {
                String reason = extractReasonFromEventMessage(message);
                if (reason != null && !reason.isBlank()) {
                    target.errorReason = reason;
                }
            }

            String resolvedPath = extractResolvedPathFromEventMessage(message);
            if (resolvedPath != null && !resolvedPath.isBlank()) {
                target.resolvedPath = resolvedPath;
                target.destinationFolder = detectDestinationFolder(resolvedPath);
            } else if ("file_completed".equals(eventType) && "completed".equals(derivedStatus)) {
                String destination = extractDestinationFromEventMessage(message);
                if (destination != null && !destination.isBlank()) {
                    target.destinationFolder = destination;
                }
            }

            if (ev.getEventTime() != null) {
                target.resolvedAt = ev.getEventTime();
            }
        }

        reconcileWithTerminalSessionStatus(session, byPath.values());

        enrichDestinationFromLogs(session, byPath.values());

        // Append destination info to display names for completed files
        // For SANDBOX with reason, include the reason in display
        for (MutableFileStatus m : byPath.values()) {
            if ("completed".equalsIgnoreCase(m.fileStatus) && m.destinationFolder != null && !m.destinationFolder.isBlank()) {
                if (m.fileName != null && !m.fileName.contains("[")) {
                    if ("SANDBOX".equalsIgnoreCase(m.destinationFolder) && m.errorReason != null && !m.errorReason.isBlank()) {
                        m.fileName = m.fileName + " [SANDBOX: " + m.errorReason.substring(0, Math.min(50, m.errorReason.length())) + "]";
                    } else {
                        m.fileName = m.fileName + " [" + m.destinationFolder + "]";
                    }
                }
            }
        }

        return byPath.values().stream()
                .map(m -> {
                    // Fallback: if createdAt was never set (pending row already deleted),
                    // use the session's createdAt so the chart x-axis shows a real date.
                    if (m.createdAt == null && session.getCreatedAt() != null) {
                        m.createdAt = session.getCreatedAt();
                    }
                    return m.toDto();
                })
                .toList();
    }

    private void enrichDestinationFromLogs(ReloadSessionEntity session, Collection<MutableFileStatus> files) {
        if (session == null || files == null || files.isEmpty()) return;
        String environment = session.getEnvironment();
        if (environment == null || environment.isBlank()) return;

        for (MutableFileStatus m : files) {
            if (m == null) continue;
            if (!"completed".equalsIgnoreCase(m.fileStatus)) continue;
            if (m.destinationFolder != null && !m.destinationFolder.isBlank()) continue;
            if (m.fileName == null || m.fileName.isBlank()) continue;

            // Try pp_log first
            if (ppLogQueryService != null) {
                PpLogQueryService.PpLogResult ppLogResult = ppLogQueryService.queryByLotAndEnv(
                        m.userLotId, environment, m.fileName);
                
                if (ppLogResult != null && ppLogResult.destination() != null && !ppLogResult.destination().isBlank()) {
                    m.destinationFolder = ppLogResult.destination();
                    
                    // If SANDBOX and result has reason → set errorReason, skip .log file path
                    if ("SANDBOX".equalsIgnoreCase(ppLogResult.destination()) && 
                        ppLogResult.reason() != null && !ppLogResult.reason().isBlank()) {
                        m.errorReason = ppLogResult.reason();
                    }
                    
                    log.debug("[SessionService] Enriched destination from pp_log: fileName='{}', destination={}", 
                            m.fileName, m.destinationFolder);
                    continue;
                }
            }

            // Fall back to existing .log file method
            if (envFolderResolver == null || sshClient == null || xfcsProperties == null) {
                continue;
            }

            EnvFolderResolver.EnvResolutionInfo res = envFolderResolver.resolveEnvDetails(environment);

            // Determine log path: prefer explicit --log from .cfg, fall back to convention:
            //   <dataRoot>/<envName_lower>/log/<envName_lower>.log
            // e.g. /apps/exensio_data/data/szft_eagle/log/szft_eagle.log
            String logPath = null;
            if (res != null && res.logPath() != null && !res.logPath().isBlank()) {
                logPath = res.logPath();
            } else {
                // Convention-based: dataRoot / envName / log / envName.log
                String envLower = environment.toLowerCase(java.util.Locale.ROOT);
                String dataRoot = xfcsProperties.getDataRoot();
                if (dataRoot != null && !dataRoot.isBlank()) {
                    logPath = java.nio.file.Paths.get(dataRoot)
                            .resolve(envLower)
                            .resolve("log")
                            .resolve(envLower + ".log")
                            .toString()
                            .replace("\\", "/");
                    log.debug("[SessionService] No --log in cfg for env='{}', using convention log path: {}", environment, logPath);
                }
            }

            if (logPath == null || logPath.isBlank()) {
                log.debug("[SessionService] No logPath resolved for env='{}', skipping destination enrichment", environment);
                continue;
            }

            String fromLog = inferDestinationFromLog(logPath, m.fileName);
            if (fromLog != null && !fromLog.isBlank()) {
                m.destinationFolder = fromLog;

                // If SANDBOX, try to extract the reason
                if ("SANDBOX".equalsIgnoreCase(fromLog)) {
                    String sandboxReason = extractSandboxReason(logPath, m.fileName);
                    if (sandboxReason != null && !sandboxReason.isBlank()) {
                        m.errorReason = sandboxReason;
                    }
                }
            }
        }
    }

    private String inferDestinationFromLog(String logPath, String fileName) {
        try {
            // Strip _reloaded_<timestamp> suffix so we match any reload attempt of the same file.
            // e.g. NXV08H400XT2_..._reloaded_20260413065625.LOG → NXV08H400XT2_..._reloaded_
            // The log's infile line may have a different reload timestamp.
            String searchTerm = toLogSearchTerm(fileName);

            // Try local read first — the ETL log is written locally on the app server (mounted disk).
            java.nio.file.Path localLog = java.nio.file.Paths.get(logPath);
            if (java.nio.file.Files.exists(localLog)) {
                try {
                    String content = java.nio.file.Files.readString(localLog);
                    StringBuilder relevant = new StringBuilder();
                    for (String line : content.split("\\r?\\n")) {
                        if (line.contains(searchTerm)) {
                            relevant.append(line).append("\n");
                        }
                    }
                    if (relevant.length() > 0) {
                        String result = detectDestinationFolder(relevant.toString());
                        if (result != null) {
                            log.debug("[SessionService] Detected destination '{}' for '{}' from local log", result, fileName);
                            return result;
                        }
                    }
                } catch (Exception e) {
                    log.debug("[SessionService] Local log read failed for '{}': {}", logPath, e.getMessage());
                }
            }

            // Fall back to SSH if remote mode is configured and local read didn't work
            if (!("REMOTE".equalsIgnoreCase(xfcsProperties.getCfgReadMode())
                    || "REMOTE".equalsIgnoreCase(xfcsProperties.getMgrReadMode()))) {
                return null;
            }

            String safeLogPath = shellSingleQuote(logPath);
            String safeSearchTerm = shellSingleQuote(searchTerm);
            String inner = "if [ -f " + safeLogPath + " ]; then grep -i -F -- " + safeSearchTerm + " " + safeLogPath + " | tail -n 120; fi";
            String cmd = "bash -l -c " + shellSingleQuote(inner);

            String output = sshClient.runRemoteCommand(
                    xfcsProperties.getRemoteHost(),
                    xfcsProperties.getRemotePort(),
                    xfcsProperties.getRemoteUser(),
                    xfcsProperties.getRemotePrivateKeyPath(),
                    xfcsProperties.getRemotePassword(),
                    xfcsProperties.getRemoteKnownHostsPath(),
                    xfcsProperties.isRemoteStrictHostKey(),
                    xfcsProperties.getRemoteConnectTimeoutMs(),
                    xfcsProperties.getRemoteReadTimeoutMs(),
                    cmd
            );

            if (output == null || output.isBlank()) return null;
            return detectDestinationFolder(output);
        } catch (Exception e) {
            log.warn("Failed to infer destination from ETL log for file '{}': {}", fileName, e.getMessage());
            return null;
        }
    }

    /**
     * Returns the search term to use when grepping the ETL log for a given filename.
     * Strips the reload timestamp suffix so different reload attempts of the same file all match.
     * e.g. "NXV08H400XT2_..._reloaded_20260413065625.LOG" → "NXV08H400XT2_..._reloaded_"
     * If no _reloaded_ suffix, returns the filename as-is (minus extension for broader matching).
     */
    private String toLogSearchTerm(String fileName) {
        if (fileName == null) return "";
        // Strip [PRODUCTION] / [SANDBOX] suffix appended by display logic
        String name = fileName.replaceAll("\\s*\\[.*?\\]\\s*$", "").trim();
        // Find _reloaded_ and keep everything up to and including it
        int reloadedIdx = name.toLowerCase(java.util.Locale.ROOT).indexOf("_reloaded_");
        if (reloadedIdx >= 0) {
            return name.substring(0, reloadedIdx + "_reloaded_".length());
        }
        return name;
    }

    private String extractSandboxReason(String logPath, String fileName) {
        try {
            String searchTerm = toLogSearchTerm(fileName);

            // Try local read first
            java.nio.file.Path localLog = java.nio.file.Paths.get(logPath);
            if (java.nio.file.Files.exists(localLog)) {
                try {
                    String content = java.nio.file.Files.readString(localLog);
                    StringBuilder sandboxLines = new StringBuilder();
                    for (String line : content.split("\\r?\\n")) {
                        if (line.contains(searchTerm) && line.toUpperCase(java.util.Locale.ROOT).contains("SANDBOX")) {
                            sandboxLines.append(line).append("\n");
                        }
                    }
                    if (sandboxLines.length() > 0) {
                        String output = sandboxLines.toString();
                        String[] patterns = {"(?i)reason[:\\s=]+([^\\|\\n]+)", "(?i)message[:\\s=]+([^\\|\\n]+)"};
                        for (String pattern : patterns) {
                            java.util.regex.Pattern p = java.util.regex.Pattern.compile(pattern);
                            java.util.regex.Matcher m = p.matcher(output);
                            if (m.find()) {
                                String reason = m.group(1).trim();
                                if (!reason.isBlank()) return reason;
                            }
                        }
                        return output.trim();
                    }
                } catch (Exception e) {
                    log.debug("[SessionService] Local log read failed for sandbox reason '{}': {}", logPath, e.getMessage());
                }
            }

            if (!("REMOTE".equalsIgnoreCase(xfcsProperties.getCfgReadMode())
                    || "REMOTE".equalsIgnoreCase(xfcsProperties.getMgrReadMode()))) {
                return null;
            }

            String safeLogPath = shellSingleQuote(logPath);
            String safeSearchTerm = shellSingleQuote(searchTerm);
            String inner = "if [ -f " + safeLogPath + " ]; then grep -i -F -- " + safeSearchTerm + " " + safeLogPath + " | grep -i sandbox | head -n 1; fi";
            String cmd = "bash -l -c " + shellSingleQuote(inner);

            String output = sshClient.runRemoteCommand(
                    xfcsProperties.getRemoteHost(),
                    xfcsProperties.getRemotePort(),
                    xfcsProperties.getRemoteUser(),
                    xfcsProperties.getRemotePrivateKeyPath(),
                    xfcsProperties.getRemotePassword(),
                    xfcsProperties.getRemoteKnownHostsPath(),
                    xfcsProperties.isRemoteStrictHostKey(),
                    xfcsProperties.getRemoteConnectTimeoutMs(),
                    xfcsProperties.getRemoteReadTimeoutMs(),
                    cmd
            );

            if (output == null || output.isBlank()) return null;

            // Try to extract reason from log line patterns:
            // - "Reason: ..." or "Reason=..."
            // - "Message: ..." or "Message=..."
            String[] patterns = {"(?i)reason[:\\s=]+([^\\|\\n]+)", "(?i)message[:\\s=]+([^\\|\\n]+)"};
            for (String pattern : patterns) {
                java.util.regex.Pattern p = java.util.regex.Pattern.compile(pattern);
                java.util.regex.Matcher m = p.matcher(output);
                if (m.find()) {
                    String reason = m.group(1).trim();
                    if (!reason.isBlank()) {
                        return reason;
                    }
                }
            }

            // Fallback: return the whole line as reason if extraction fails
            return output.trim();
        } catch (Exception e) {
            log.debug("Failed to extract sandbox reason from ETL log for file '{}': {}", fileName, e.getMessage());
            return null;
        }
    }

    private String shellSingleQuote(String s) {
        if (s == null) return "''";
        return "'" + s.replace("'", "'\\''") + "'";
    }

    private String detectDestinationFolder(String text) {
        if (text == null || text.isBlank()) return null;
        String[] lines = text.split("\\r?\\n");
        for (int i = lines.length - 1; i >= 0; i--) {
            String l = lines[i] == null ? "" : lines[i].toUpperCase(Locale.ROOT);
            if (l.contains("SANDBOX")) return "SANDBOX";
            if (l.contains("PRODUCTION")) return "PRODUCTION";
        }

        String up = text.toUpperCase(Locale.ROOT);
        if (up.contains("SANDBOX")) return "SANDBOX";
        if (up.contains("PRODUCTION")) return "PRODUCTION";
        return null;
    }

    private MutableFileStatus findByFileName(Map<String, MutableFileStatus> byPath, String fileName) {
        String wantedCanonical = canonicalFileKey(fileName);
        for (MutableFileStatus m : byPath.values()) {
            if (m.fileName != null && m.fileName.equals(fileName)) {
                return m;
            }
            if ((m.fileName == null || m.fileName.isBlank()) && m.absPath != null && fileName.equals(fileNameOf(m.absPath))) {
                return m;
            }

            String candidate = (m.fileName != null && !m.fileName.isBlank()) ? m.fileName : fileNameOf(m.absPath);
            String candidateCanonical = canonicalFileKey(candidate);
            if (wantedCanonical != null && wantedCanonical.equals(candidateCanonical)) {
                return m;
            }
        }
        return null;
    }

    /**
     * Builds a stable comparison key for archive/original/renamed file variants.
     * Example mappings to same key:
     * - PW.._43300534.CPR_MD5-<hash>.gz
     * - PW.._43300534_reloaded_20260328121935.CPR
     */
    private String canonicalFileKey(String name) {
        if (name == null || name.isBlank()) return null;

        String clean = fileNameOf(name);
        if (clean == null || clean.isBlank()) return null;

        clean = clean.replaceAll("(?i)\\.gz$", "");
        clean = clean.replaceAll("(?i)_MD5-[0-9a-f]{32}", "");
        clean = clean.replaceAll("(?i)_reloaded_\\d{14}", "");
        return clean.toLowerCase(Locale.ROOT);
    }

    private int statusRank(String status) {
        if (status == null) return 0;
        return switch (status.toLowerCase(Locale.ROOT)) {
            case "failed"      -> 5;
            case "completed"   -> 4;
            case "unverified-exensio"  -> 4; // terminal like completed — ETL done, Exensio unconfirmed
            case "etl_complete" -> 3;
            case "staging"     -> 2;
            case "pending", "created" -> 1;
            default -> 0;
        };
    }

    private void reconcileWithTerminalSessionStatus(ReloadSessionEntity session, Collection<MutableFileStatus> files) {
        if (session == null || files == null || files.isEmpty()) return;
        String state = session.getStatus() == null ? "" : session.getStatus().toLowerCase(Locale.ROOT);
        Instant terminalTime = session.getCompletedAt();

        if ("completed".equals(state)) {
            for (MutableFileStatus m : files) {
                if (m == null) continue;
                if ("pending".equalsIgnoreCase(m.fileStatus) || "staging".equalsIgnoreCase(m.fileStatus)
                        || "etl_complete".equalsIgnoreCase(m.fileStatus)) {
                    m.fileStatus = "completed";
                    if (m.resolvedAt == null) m.resolvedAt = terminalTime;
                }
                // unverified stays unverified — it carries a specific meaning for the user
            }
            return;
        }

        if ("failed".equals(state) || "partially_failed".equals(state)) {
            for (MutableFileStatus m : files) {
                if (m == null) continue;
                if ("pending".equalsIgnoreCase(m.fileStatus) || "staging".equalsIgnoreCase(m.fileStatus)) {
                    m.fileStatus = "failed";
                    if (m.errorReason == null || m.errorReason.isBlank()) {
                        m.errorReason = "Session ended without terminal per-file event";
                    }
                    if (m.resolvedAt == null) m.resolvedAt = terminalTime;
                }
                // etl_complete and unverified keep their status — already resolved
            }
        }
    }

    private String extractFileNameFromEventMessage(String message) {
        if (message == null || message.isBlank()) return null;

        int marker = message.indexOf(": ");
        if (marker < 0 || marker + 2 >= message.length()) return null;

        String after = message.substring(marker + 2);
        int lotMarker = after.indexOf(" (Lot:");
        if (lotMarker > 0) {
            return after.substring(0, lotMarker).trim();
        }

        int reasonMarker = after.indexOf(" | Reason:");
        if (reasonMarker > 0) {
            return after.substring(0, reasonMarker).trim();
        }

        return after.trim();
    }

    private String extractReasonFromEventMessage(String message) {
        if (message == null || message.isBlank()) return null;
        String token = " | Reason:";
        int idx = message.indexOf(token);
        if (idx < 0) return null;
        String tail = message.substring(idx + token.length()).trim();
        return tail.isBlank() ? null : tail;
    }

    private String extractResolvedPathFromEventMessage(String message) {
        if (message == null || message.isBlank()) return null;
        String token = "File moved to:";
        int idx = message.indexOf(token);
        if (idx < 0) return null;
        String tail = message.substring(idx + token.length()).trim();
        return tail.isBlank() ? null : tail;
    }

    private String extractDestinationFromEventMessage(String message) {
        if (message == null || message.isBlank()) return null;
        String token = " | Destination:";
        int idx = message.indexOf(token);
        if (idx < 0) return null;
        String tail = message.substring(idx + token.length()).trim();
        return tail.isBlank() ? null : tail;
    }

    private String fileNameOf(String path) {
        if (path == null || path.isBlank()) return null;
        String normalized = path.replace("\\", "/");
        int idx = normalized.lastIndexOf('/');
        return idx >= 0 ? normalized.substring(idx + 1) : normalized;
    }

    private static final class MutableFileStatus {
        String absPath;
        String fileName;
        String originalFileName;
        String userLotId;
        String fileStatus;
        String errorReason;
        String resolvedPath;
        String destinationFolder;
        Instant createdAt;
        Instant resolvedAt;

        static MutableFileStatus pending(String absPath, String fileName, String userLotId) {
            MutableFileStatus m = new MutableFileStatus();
            m.absPath = absPath;
            m.fileName = fileName;
            m.originalFileName = fileName;
            m.userLotId = userLotId;
            m.fileStatus = "pending";
            return m;
        }

        FileStatusDto toDto() {
            return new FileStatusDto(
                    absPath,
                    fileName,
                    originalFileName,
                    userLotId,
                    fileStatus,
                    errorReason,
                    resolvedPath,
                    destinationFolder,
                    createdAt,
                    resolvedAt
            );
        }
    }

    @Transactional
    public ReloadStatus cancelSession(String sessionId) {
        ReloadSessionEntity session = reloadSessionRepository.findById(sessionId)
                .orElseThrow(() -> new IllegalArgumentException("Session not found: " + sessionId));

        String currentStatus = session.getStatus() == null ? "" : session.getStatus().toLowerCase();
        if (TERMINAL_STATUSES.contains(currentStatus)) {
            throw new SessionAlreadyTerminalException(sessionId);
        }

        session.setStatus("cancelled");
        session.setCompletedAt(Instant.now());
        session.setMessage("Session cancelled by operator");
        reloadSessionRepository.save(session);

        appendEvent(sessionId, "SESSION_CANCELLED", "Session cancelled by operator", "OPERATOR", null);

        // Remove all pending files
        reloadPendingFileRepository.deleteBySessionId(sessionId);
        reloadPendingFileRepository.flush();

        sseEventBroker.complete(sessionId);

        return getStatus(sessionId);
    }

    @Transactional(readOnly = true)
    public List<ReloadStatus> all() {
        return reloadSessionRepository.findAll().stream()
                .map(this::toDto)
                .sorted(Comparator.comparing(ReloadStatus::updatedAt, Comparator.nullsLast(Comparator.reverseOrder())))
                .toList();
    }

    @Transactional(readOnly = true)
    public List<ReloadStatus> byRequester(String requester) {
        return reloadSessionRepository.findByRequester(requester).stream()
                .map(this::toDto)
                .sorted(Comparator.comparing(ReloadStatus::updatedAt, Comparator.nullsLast(Comparator.reverseOrder())))
                .toList();
    }

    public int completedCount() {
        return (int) reloadSessionRepository.countByStatusIgnoreCase("completed");
    }

    public int failedCount() {
        return (int) reloadSessionRepository.countByStatusIgnoreCase("failed");
    }

    @Transactional(readOnly = true)
    public List<String> getRecentLots(int limit) {
        List<ReloadSessionEntity> recent = reloadSessionRepository.findTop20ByOrderByCreatedAtDesc();
        Set<String> lots = new LinkedHashSet<>();
        
        for (ReloadSessionEntity entity : recent) {
            String details = entity.getDetails();
            if (details == null || details.isBlank()) continue;
            
            try {
                // The details field stores the original ReloadRequest as JSON
                ReloadRequest req = objectMapper.readValue(details, ReloadRequest.class);
                if (req.files() != null && !req.files().isEmpty()) {
                    for (ReloadRequest.ReloadFileItem f : req.files()) {
                        if (f.userLotId() != null && !f.userLotId().isBlank()) {
                            // Extract just the alphanumeric lot ID if it was submitted as a wildcard
                            String cleanly = f.userLotId().replace("*", "").replace("%", "");
                            if (!cleanly.isBlank()) {
                                lots.add(cleanly);
                                if (lots.size() >= limit) return new ArrayList<>(lots);
                            }
                        }
                    }
                } else if (req.filePaths() != null) {
                    for (String path : req.filePaths()) {
                        String lot = FilenameParser.parseLotId(path);
                        if (lot != null) {
                            lots.add(lot);
                            if (lots.size() >= limit) return new ArrayList<>(lots);
                        }
                    }
                }
            } catch (Exception e) {
                // Fallback: simple string scan if JSON parsing fails
                String[] parts = details.split("[\",:]");
                for (String part : parts) {
                    String lot = FilenameParser.parseLotId(part.trim());
                    if (lot != null) {
                        lots.add(lot);
                        if (lots.size() >= limit) return new ArrayList<>(lots);
                    }
                }
            }
        }
        return new ArrayList<>(lots);
    }

    private ReloadStatus toDto(ReloadSessionEntity entity) {
        String sessionId = entity.getSessionId();
        int totalFiles = Optional.ofNullable(entity.getFileCount()).orElse(0);
        
        // "Done" = ETL resolved outcomes. Includes:
        // - file_completed: confirmed loaded in Exensio
        // - file_etl_completed: ETL done, awaiting Exensio confirmation
        // - file_unverified: ETL done but Exensio check failed/timed out — user must verify manually
        int completedFiles = (int) reloadSessionEventRepository.countBySessionIdAndEventType(sessionId, "file_completed")
                + (int) reloadSessionEventRepository.countBySessionIdAndEventType(sessionId, "file_etl_completed")
                + (int) reloadSessionEventRepository.countBySessionIdAndEventType(sessionId, "file_unverified");
        int failedFiles = (int) reloadSessionEventRepository.countBySessionIdAndEventType(sessionId, "file_failed");

        List<String> filePaths = Collections.emptyList();
        List<ReloadRequest.ReloadFileItem> files = Collections.emptyList();
        String details = entity.getDetails();
        if (details != null && !details.isBlank()) {
            try {
                ReloadRequest req = objectMapper.readValue(details, ReloadRequest.class);
                filePaths = req.filePaths() != null ? req.filePaths() : Collections.emptyList();
                files = req.files() != null ? req.files() : Collections.emptyList();
            } catch (Exception e) {
                log.warn("Failed to parse session details for files: {}", sessionId);
            }
        }
 
        return new ReloadStatus(
                sessionId,
                entity.getStatus(),
                entity.getMessage(),
                entity.getRequester(),
                entity.getEnvironment(),
                entity.getCreatedAt(),
                Optional.ofNullable(entity.getCompletedAt()).orElse(entity.getStartedAt()),
                totalFiles,
                completedFiles,
                failedFiles,
                filePaths,
                files
        );
    }

    /**
     * Fetch file coverage data grouped by date bucket, environment, and file status.
     * Mirrors the coverage report from exensioreload.
     *
     * @param environment optional filter — if null/blank, all environments are included
     * @param granularity  "day", "week", or "month"
     * @param dateFrom     optional start date (inclusive)
     * @param dateTo       optional end date (inclusive)
     */
    public List<FileCoveragePoint> getFileCoverage(String environment, String granularity,
                                                    String dateFrom, String dateTo) {
        boolean isOracle = isOracleDialect();

        // Date truncation SQL fragment specific to each DB dialect.
        // Oracle: cast to TIMESTAMP WITH TIME ZONE at UTC first, then TRUNC —
        //         guards against the DB session timezone shifting bucket boundaries.
        // H2:     stored as epoch millis, FORMATDATETIME interprets in JVM timezone;
        //         with hibernate.jdbc.time_zone=UTC and JVM in UTC this is consistent.
        String pfDateExpr = isOracle
                ? "(CASE WHEN pf.archive_year IS NOT NULL AND pf.archive_month IS NOT NULL\n" +
                  "      THEN TO_DATE(pf.archive_year || '-' || pf.archive_month || '-01', 'YYYY-MM-DD')\n" +
                  "      ELSE TRUNC(CAST(pf.created_at AS TIMESTAMP) AT TIME ZONE 'UTC')\n" +
                  " END)"
                : "(CASE WHEN pf.archive_year IS NOT NULL AND pf.archive_month IS NOT NULL\n" +
                  "      THEN PARSEDATETIME(CAST(pf.archive_year AS VARCHAR) || '-' || CAST(pf.archive_month AS VARCHAR) || '-01', 'yyyy-M-d')\n" +
                  "      ELSE CAST(pf.created_at AS DATE)\n" +
                  " END)";

        String dateTruncExpr = isOracle
                ? switch (granularity) {
                    case "week"  -> "TO_CHAR(TRUNC(" + pfDateExpr + ", 'IW'), 'YYYY-MM-DD')";
                    case "month" -> "TO_CHAR(TRUNC(" + pfDateExpr + ", 'MM'), 'YYYY-MM-DD')";
                    default      -> "TO_CHAR(TRUNC(" + pfDateExpr + ", 'DD'), 'YYYY-MM-DD')";
                  }
                : switch (granularity) {
                    case "week"  -> "FORMATDATETIME(" + pfDateExpr + ", 'YYYY-ww')";
                    case "month" -> "FORMATDATETIME(" + pfDateExpr + ", 'yyyy-MM') || '-01'";
                    default      -> "FORMATDATETIME(" + pfDateExpr + ", 'yyyy-MM-dd')";
                  };

        StringBuilder sql = new StringBuilder(
                "SELECT " + dateTruncExpr + " AS bucket,\n" +
                "       pf.environment,\n" +
                "       COUNT(*)                        AS total,\n" +
                "       SUM(CASE WHEN pf.file_status = 'completed'                              THEN 1 ELSE 0 END) AS done,\n" +
                "       SUM(CASE WHEN pf.file_status IN ('staging','exensio_loading','etl_complete')   THEN 1 ELSE 0 END) AS enqueued,\n" +
                "       SUM(CASE WHEN pf.file_status = 'pending'                                THEN 1 ELSE 0 END) AS staged,\n" +
                "       SUM(CASE WHEN pf.file_status = 'failed'                                 THEN 1 ELSE 0 END) AS failed\n" +
                "FROM (\n" +
                "  SELECT created_at, environment, file_status, archive_year, archive_month\n" +
                "  FROM xfcs_dearchiver_reload_pending_files\n" +
                "  UNION ALL\n" +
                "  SELECT s.created_at, s.environment,\n" +
                "         (CASE WHEN ev.event_type = 'file_completed' THEN 'completed'\n" +
                "               WHEN ev.event_type = 'file_failed'    THEN 'failed'\n" +
                "               WHEN ev.event_type = 'file_unverified' THEN 'failed'\n" +
                "               ELSE 'pending' END) AS file_status,\n" +
                "         ev.archive_year,\n" +
                "         ev.archive_month\n" +
                "  FROM xfcs_dearchiver_reload_session_events ev\n" +
                "  JOIN xfcs_dearchiver_reload_sessions s ON s.session_id = ev.session_id\n" +
                "  WHERE ev.event_type IN ('file_completed', 'file_failed', 'file_unverified')\n" +
                ") pf\n" +
                "WHERE 1=1\n");

        // Use named parameters to avoid positional index issues and Oracle JDBC type binding.
        // For date params we pass a java.sql.Timestamp which Oracle JDBC handles correctly.
        if (environment != null && !environment.isBlank()) {
            sql.append("  AND pf.environment = :env\n");
        }
        if (dateFrom != null && !dateFrom.isBlank()) {
            sql.append("  AND ").append(pfDateExpr).append(" >= :dateFrom\n");
        }
        if (dateTo != null && !dateTo.isBlank()) {
            sql.append("  AND ").append(pfDateExpr).append(" < :dateTo\n");
        }

        sql.append("GROUP BY ").append(dateTruncExpr).append(", pf.environment\n")
           .append("ORDER BY bucket ASC, pf.environment ASC");

        Query query = entityManager.createNativeQuery(sql.toString());

        if (environment != null && !environment.isBlank()) {
            query.setParameter("env", environment);
        }
        if (dateFrom != null && !dateFrom.isBlank()) {
            // Pass as java.sql.Timestamp so Oracle JDBC binds it as TIMESTAMP, not BINARY_FLOAT
            query.setParameter("dateFrom", java.sql.Timestamp.from(parseDateStart(dateFrom)));
        }
        if (dateTo != null && !dateTo.isBlank()) {
            query.setParameter("dateTo", java.sql.Timestamp.from(parseDateEnd(dateTo)));
        }

        @SuppressWarnings("unchecked")
        List<Object[]> rows = query.getResultList();

        List<FileCoveragePoint> results = new ArrayList<>(rows.size());
        for (Object[] row : rows) {
            String bkt = row[0] != null ? row[0].toString() : "unknown";
            String env = row[1] != null ? row[1].toString() : "unknown";
            long total    = toLong(row[2]);
            long done     = toLong(row[3]);
            long enqueued = toLong(row[4]);
            long staged   = toLong(row[5]);
            long failed   = toLong(row[6]);
            results.add(new FileCoveragePoint(bkt, env, total, done, enqueued, staged, failed));
        }
        return results;
    }

    private boolean isOracleDialect() {
        // Check the JPA database-platform property set in application.yml.
        // This avoids any runtime connection unwrapping which can throw in managed JPA contexts.
        try {
            Object platformProp = entityManager.getEntityManagerFactory()
                    .getProperties()
                    .get("hibernate.dialect");
            if (platformProp != null && platformProp.toString().toLowerCase().contains("oracle")) {
                log.debug("[Coverage] Detected Oracle dialect from hibernate.dialect property: {}", platformProp);
                return true;
            }
            // Also check JPA database-platform variant
            Object jpaDialect = entityManager.getEntityManagerFactory()
                    .getProperties()
                    .get("javax.persistence.database-product-name");
            if (jpaDialect != null && jpaDialect.toString().toLowerCase().contains("oracle")) {
                return true;
            }
        } catch (Exception e) {
            log.warn("[Coverage] Could not detect DB dialect, defaulting to non-Oracle: {}", e.getMessage());
        }
        return false;
    }

    private static long toLong(Object value) {
        if (value == null) return 0;
        if (value instanceof Number n) return n.longValue();
        try { return Long.parseLong(value.toString()); } catch (NumberFormatException e) { return 0; }
    }

    /**
     * Parse a date parameter (YYYY-MM-DD or YYYY-MM-DDT00:00:00Z) to a UTC Instant
     * representing the start of that calendar day (midnight UTC).
     */
    private static Instant parseDateStart(String dateStr) {
        String s = dateStr.trim();
        if (s.length() == 10) {
            return LocalDate.parse(s).atStartOfDay(ZoneOffset.UTC).toInstant();
        }
        // ISO instant format: YYYY-MM-DDT00:00:00Z
        return Instant.parse(s);
    }

    /**
     * Parse a date parameter (YYYY-MM-DD or YYYY-MM-DDT00:00:00Z) to a UTC Instant
     * representing the exclusive end of that calendar day (midnight UTC next day).
     */
    private static Instant parseDateEnd(String dateStr) {
        String s = dateStr.trim();
        if (s.length() == 10) {
            return LocalDate.parse(s).plusDays(1).atStartOfDay(ZoneOffset.UTC).toInstant();
        }
        // ISO instant: treat as day start and add one day
        Instant start = Instant.parse(s);
        return start.plus(java.time.Duration.ofDays(1));
    }

    private ReloadSessionEvent toEventDto(ReloadSessionEventEntity entity) {
        return new ReloadSessionEvent(
                entity.getId(),
                entity.getSessionId(),
                entity.getEventTime(),
                entity.getEventType(),
                entity.getMessage(),
                entity.getActor(),
                entity.getErrorCode()
        );
    }

    private void appendEvent(String sessionId, String type, String message, String actor, String errorCode) {
        ReloadSessionEventEntity event = new ReloadSessionEventEntity();
        event.setSessionId(sessionId);
        event.setEventTime(Instant.now());
        event.setEventType(type);
        event.setMessage(message);
        event.setActor(actor);
        event.setErrorCode(errorCode);
        ReloadSessionEventEntity saved = reloadSessionEventRepository.save(event);

        ReloadSessionEvent dto = new ReloadSessionEvent(
                saved.getId(), sessionId, saved.getEventTime(), type, message, actor, errorCode
        );
        sseEventBroker.publish(sessionId, dto);
    }

    private String toDetailsJson(ReloadRequest request) {
        try {
            return objectMapper.writeValueAsString(request);
        } catch (JsonProcessingException e) {
            return "{}";
        }
    }
}
