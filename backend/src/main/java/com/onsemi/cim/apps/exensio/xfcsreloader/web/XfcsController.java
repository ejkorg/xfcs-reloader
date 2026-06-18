package com.onsemi.cim.apps.exensio.xfcsreloader.web;

import com.onsemi.cim.apps.exensio.xfcsreloader.config.XfcsProperties;
import com.onsemi.cim.apps.exensio.xfcsreloader.repository.ReloadPendingFileRepository;
import com.onsemi.cim.apps.exensio.xfcsreloader.repository.ReloadSessionRepository;
import com.onsemi.cim.apps.exensio.xfcsreloader.service.ArchiveSearchService;
import com.onsemi.cim.apps.exensio.xfcsreloader.service.EnvConfigService;
import com.onsemi.cim.apps.exensio.xfcsreloader.service.EnvFolderResolver;
import com.onsemi.cim.apps.exensio.xfcsreloader.service.ReloadSessionService;
import com.onsemi.cim.apps.exensio.xfcsreloader.service.SseEventBroker;
import com.onsemi.cim.apps.exensio.xfcsreloader.web.dto.*;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.*;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

@RestController
@RequestMapping("/api/xfcs")
public class XfcsController {

    private static final Logger log = LoggerFactory.getLogger(XfcsController.class);

    private final EnvConfigService envConfigService;
    private final ReloadSessionService reloadSessionService;
    private final ArchiveSearchService archiveSearchService;
    private final XfcsProperties xfcsProperties;
    private final EnvFolderResolver envFolderResolver;
    private final SseEventBroker sseEventBroker;
    private final ReloadSessionRepository reloadSessionRepository;
    private final ReloadPendingFileRepository reloadPendingFileRepository;

    public XfcsController(EnvConfigService envConfigService,
                          ReloadSessionService reloadSessionService,
                          ArchiveSearchService archiveSearchService,
                          XfcsProperties xfcsProperties,
                          EnvFolderResolver envFolderResolver,
                          SseEventBroker sseEventBroker,
                          ReloadSessionRepository reloadSessionRepository,
                          ReloadPendingFileRepository reloadPendingFileRepository) {
        this.envConfigService = envConfigService;
        this.reloadSessionService = reloadSessionService;
        this.archiveSearchService = archiveSearchService;
        this.xfcsProperties = xfcsProperties;
        this.envFolderResolver = envFolderResolver;
        this.sseEventBroker = sseEventBroker;
        this.reloadSessionRepository = reloadSessionRepository;
        this.reloadPendingFileRepository = reloadPendingFileRepository;
    }

    @GetMapping("/ping")
    public Map<String, Object> ping() {
        return Map.of("ok", true, "ts", Instant.now().toString());
    }

    @GetMapping("/envs")
    @PreAuthorize("hasAnyRole('ADMIN','USER','SUPER_ADMIN')")
    public List<EnvYearRange> envs() {
        assertFeatureEnabled();
        return envConfigService.loadEnvs();
    }

    @GetMapping("/cache/info")
    @PreAuthorize("hasAnyRole('ADMIN','SUPER_ADMIN')")
    public EnvConfCacheInfo cacheInfo() {
        assertFeatureEnabled();
        return envConfigService.getCacheInfo();
    }

    @PostMapping("/cache/refresh")
    @PreAuthorize("hasAnyRole('ADMIN','SUPER_ADMIN')")
    public EnvConfCacheInfo refreshCache() {
        assertFeatureEnabled();
        return envConfigService.refreshNow();
    }

    @PostMapping("/archive/search")
    @PreAuthorize("hasAnyRole('ADMIN','USER','SUPER_ADMIN')")
    public List<SearchResult> search(@RequestBody SearchCriteria criteria) {
        assertFeatureEnabled();
        log.info("[Xfcs] /archive/search called with criteria: {}", criteria);
        List<SearchResult> results = archiveSearchService.search(criteria);
        log.info("[Xfcs] /archive/search returned {} results", results.size());
        return results;
    }

    @GetMapping("/archive/find-lots")
    @PreAuthorize("hasAnyRole('ADMIN','USER','SUPER_ADMIN')")
    public List<ArchiveLotDetail> findLots(@RequestParam("environment") String environment,
                                           @RequestParam(value = "lot", required = false) String lot,
                                           @RequestParam(value = "wafer", required = false) String wafer) {
        assertFeatureEnabled();
        return archiveSearchService.findLots(environment, lot, wafer);
    }

    @PostMapping("/files/download")
    @PreAuthorize("hasAnyRole('ADMIN','USER','SUPER_ADMIN')")
    public ResponseEntity<byte[]> download(@RequestBody DownloadFilesRequest request) {
        assertFeatureEnabled();
        byte[] bytes = archiveSearchService.zipSelected(request.paths());

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_OCTET_STREAM);
        headers.setContentDisposition(ContentDisposition.attachment().filename("xfcs-files.zip").build());
        return ResponseEntity.ok().headers(headers).body(bytes);
    }

    @PostMapping("/reload")
    @PreAuthorize("hasAnyRole('ADMIN','USER','SUPER_ADMIN')")
    public ReloadSession createReload(@RequestBody ReloadRequest request, Authentication authentication) {
        assertFeatureEnabled();
        String requester = request.requester() != null && !request.requester().isBlank()
                ? request.requester()
                : (authentication == null ? "unknown" : authentication.getName());
        String id = reloadSessionService.create(request, requester);
        // Dispatch async processing AFTER the create() transaction commits,
        // so the async thread can find the session entity in the DB.
        reloadSessionService.dispatchProcessing(id, requester, request.files());
        return new ReloadSession(id);
    }

    @GetMapping("/reload/{sessionId}")
    @PreAuthorize("hasAnyRole('ADMIN','USER','SUPER_ADMIN')")
    public ReloadStatus status(@PathVariable String sessionId) {
        assertFeatureEnabled();
        return reloadSessionService.getStatus(sessionId);
    }

    @GetMapping("/reload/{sessionId}/events")
    @PreAuthorize("hasAnyRole('ADMIN','USER','SUPER_ADMIN')")
    public List<ReloadSessionEvent> events(@PathVariable String sessionId) {
        assertFeatureEnabled();
        return reloadSessionService.getEvents(sessionId);
    }

    @GetMapping(value = "/reload/{sessionId}/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    @PreAuthorize("hasAnyRole('ADMIN','USER','SUPER_ADMIN')")
    public SseEmitter streamSession(@PathVariable String sessionId,
                                    @RequestParam(required = false) Long lastEventId) {
        assertFeatureEnabled();
        return sseEventBroker.subscribe(sessionId, lastEventId != null ? lastEventId : 0L);
    }

    @GetMapping("/reload/{sessionId}/files")
    @PreAuthorize("hasAnyRole('ADMIN','USER','SUPER_ADMIN')")
    public List<FileStatusDto> sessionFiles(@PathVariable String sessionId) {
        assertFeatureEnabled();
        return reloadSessionService.getSessionFiles(sessionId);
    }

    @PostMapping("/reload/{sessionId}/cancel")
    @PreAuthorize("hasAnyRole('ADMIN','USER','SUPER_ADMIN')")
    public ResponseEntity<?> cancelSession(@PathVariable String sessionId) {
        assertFeatureEnabled();
        try {
            ReloadStatus status = reloadSessionService.cancelSession(sessionId);
            return ResponseEntity.ok(status);
        } catch (ReloadSessionService.SessionAlreadyTerminalException e) {
            return ResponseEntity.status(org.springframework.http.HttpStatus.CONFLICT)
                    .body(java.util.Map.of("error", "SESSION_ALREADY_TERMINAL"));
        }
    }

    @GetMapping("/envs/{environment}/info")
    @PreAuthorize("hasAnyRole('ADMIN','USER','SUPER_ADMIN')")
    public Map<String, Object> envInfo(@PathVariable("environment") String environment) {
        assertFeatureEnabled();
        List<EnvYearRange> envs = envConfigService.loadEnvs();
        EnvYearRange env = envs.stream()
                .filter(e -> e.environment() != null && e.environment().equalsIgnoreCase(environment))
                .findFirst()
                .orElse(null);

        // Resolve real inbox and cfg path via .mgr → .cfg chain
        EnvFolderResolver.EnvResolutionInfo resolution = envFolderResolver.resolveEnvDetails(environment);

        String cfgPath;
        String inboxPath;
        String stagingPath;

        if (resolution != null && resolution.inboxPath() != null) {
            cfgPath    = resolution.cfgFilePath();
            inboxPath  = resolution.inboxPath();
            stagingPath = Path.of(inboxPath).resolve(xfcsProperties.getStagingFolder()).toString();
        } else {
            // Fallback: unable to resolve via .mgr; show best-guess paths
            var cacheInfo = envConfigService.getCacheInfo();
            cfgPath  = "REMOTE".equalsIgnoreCase(cacheInfo.lastSource())
                    ? xfcsProperties.getRemoteEnvConfPath()
                    : xfcsProperties.getEnvConfPath();
            inboxPath   = Path.of(xfcsProperties.getDataRoot(), environment).toString();
            stagingPath = Path.of(inboxPath, xfcsProperties.getStagingFolder()).toString();
        }

        // Count files currently in the staging (dearchive) folder
        long count = 0;
        try {
            Path staging = Path.of(stagingPath);
            if (Files.exists(staging)) {
                try (var s = Files.walk(staging, 1)) {
                    count = s.filter(Files::isRegularFile).count();
                }
            }
        } catch (Exception ignored) {
            count = 0;
        }

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("environment", environment);
        out.put("cfgPath", cfgPath);
        out.put("inboxPath", inboxPath);
        out.put("stagingPath", stagingPath);
        out.put("fileCount", (int) Math.min(count, Integer.MAX_VALUE));
        out.put("active", env != null && env.active());
        out.put("resolvedViaMgr", resolution != null);
        if (resolution != null) {
            out.put("rawInboxPath", resolution.rawInboxPath());
            out.put("outboxPath", resolution.outboxPath());
            out.put("locationCode", resolution.locationCode());
            out.put("logPath", resolution.logPath());
        }
        return out;
    }

    @GetMapping("/sessions")
    @PreAuthorize("hasAnyRole('ADMIN','USER','SUPER_ADMIN')")
    public List<ReloadStatus> sessions(Authentication authentication) {
        assertFeatureEnabled();
        boolean isAdmin = authentication != null && authentication.getAuthorities().stream()
                .anyMatch(a -> {
                    String role = a.getAuthority();
                    return "ROLE_ADMIN".equals(role) || "ROLE_SUPER_ADMIN".equals(role) || "ADMIN".equals(role) || "SUPER_ADMIN".equals(role);
                });

        if (isAdmin) {
            return reloadSessionService.all();
        } else {
            String requester = authentication == null ? "unknown" : authentication.getName();
            return reloadSessionService.byRequester(requester);
        }
    }

    @GetMapping("/dashboard")
    @PreAuthorize("hasAnyRole('ADMIN','USER','SUPER_ADMIN')")
    public DashboardData dashboard() {
        assertFeatureEnabled();
        List<String> terminalStatuses = List.of("completed", "failed", "partially_failed", "cancelled");

        int total = (int) reloadSessionRepository.count();
        int completed = (int) reloadSessionRepository.countByStatusIgnoreCase("completed");
        int failed = (int) reloadSessionRepository.countByStatusIgnoreCase("failed");
        int activeSessions = (int) reloadSessionRepository.countByStatusNotIn(terminalStatuses);
        int pendingFiles = (int) reloadPendingFileRepository.count();
        int stuckTimeoutMin = xfcsProperties.getStuckSessionTimeoutMin();

        List<String> recentLots = reloadSessionService.getRecentLots(10);

        return new DashboardData(
                Instant.now().toString(),
                total,
                completed,
                failed,
                recentLots,
                activeSessions,
                pendingFiles,
                stuckTimeoutMin
        );
    }

    private void assertFeatureEnabled() {
        if (!xfcsProperties.isFeatureEnabled()) {
            throw new org.springframework.web.server.ResponseStatusException(
                    org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE,
                    "XFCS feature is disabled"
            );
        }
    }
}
