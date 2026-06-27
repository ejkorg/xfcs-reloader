package com.onsemi.cim.apps.exensio.xfcsreloader.service;

import com.onsemi.cim.apps.exensio.xfcsreloader.config.XfcsProperties;
import com.onsemi.cim.apps.exensio.xfcsreloader.repository.ReloadPendingFileRepository;
import com.onsemi.cim.apps.exensio.xfcsreloader.repository.ReloadSessionRepository;
import com.onsemi.cim.apps.exensio.xfcsreloader.web.XfcsController;
import net.jqwik.api.*;
import net.jqwik.api.constraints.AlphaChars;
import net.jqwik.api.constraints.StringLength;
import org.mockito.Mockito;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Property 1: Log path included in envInfo response
 *
 * For any environment that resolves successfully via EnvFolderResolver,
 * calling envInfo() should return a JSON map containing a "logPath" key
 * whose value matches EnvResolutionInfo.logPath().
 *
 * Feature: session-log-env-redesign, Property 1: Log path included in envInfo response
 * Validates: Requirements 1.1
 */
class EnvInfoLogPathPropertyTest {

    /**
     * Feature: session-log-env-redesign, Property 1: Log path included in envInfo response
     * Validates: Requirements 1.1
     *
     * For any non-null logPath, the envInfo response must contain that exact value.
     */
    @Property(tries = 100)
    void envInfoResponseContainsLogPath(
            @ForAll @AlphaChars @StringLength(min = 3, max = 10) String envName,
            @ForAll @AlphaChars @StringLength(min = 4, max = 20) String logFileName
    ) {
        String logPath = "/etl/logs/" + envName + "/" + logFileName + ".log";

        Map<String, Object> result = callEnvInfo(envName, logPath);

        assertThat(result).containsKey("logPath");
        assertThat(result.get("logPath")).isEqualTo(logPath);
    }

    /**
     * Feature: session-log-env-redesign, Property 1: Log path included in envInfo response
     * Validates: Requirements 1.2
     *
     * When logPath is null in EnvResolutionInfo, the response must contain
     * "logPath" mapped to null (not absent).
     */
    @Property(tries = 100)
    void envInfoResponseContainsNullLogPathWhenUnresolved(
            @ForAll @AlphaChars @StringLength(min = 3, max = 10) String envName
    ) {
        Map<String, Object> result = callEnvInfo(envName, null);

        assertThat(result).containsKey("logPath");
        assertThat(result.get("logPath")).isNull();
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    /**
     * Builds a minimal XfcsController with mocked dependencies and calls envInfo().
     * EnvFolderResolver is stubbed to return an EnvResolutionInfo with the given logPath.
     * EnvConfigService.loadEnvs() returns an empty list (no active env needed for this property).
     */
    private Map<String, Object> callEnvInfo(String envName, String logPath) {
        EnvConfigService envConfigService = Mockito.mock(EnvConfigService.class);
        EnvFolderResolver envFolderResolver = Mockito.mock(EnvFolderResolver.class);
        ReloadSessionService reloadSessionService = Mockito.mock(ReloadSessionService.class);
        ArchiveSearchService archiveSearchService = Mockito.mock(ArchiveSearchService.class);
        SseEventBroker sseEventBroker = Mockito.mock(SseEventBroker.class);
        ReloadSessionRepository sessionRepo = Mockito.mock(ReloadSessionRepository.class);
        ReloadPendingFileRepository pendingRepo = Mockito.mock(ReloadPendingFileRepository.class);

        XfcsProperties props = new XfcsProperties();
        props.setFeatureEnabled(true);
        props.setDataRoot("/data");
        props.setStagingFolder("staging");

        when(envConfigService.loadEnvs()).thenReturn(List.of());

        // Stub resolveEnvDetails to return a resolution with the given logPath and a valid inboxPath
        EnvFolderResolver.EnvResolutionInfo resolution = new EnvFolderResolver.EnvResolutionInfo(
                "/cfg/" + envName + ".cfg",   // cfgFilePath
                "/data/" + envName,            // inboxPath
                "/data/" + envName + "/raw",   // rawInboxPath
                "/data/" + envName + "/out",   // outboxPath
                logPath,                       // logPath (may be null)
                "CP",                          // locationCode
                "LOCAL",                       // configSource
                0                              // inboxFileCount
        );
        when(envFolderResolver.resolveEnvDetails(anyString())).thenReturn(resolution);

        // Mock ExensioPreCheckService (new dependency)
        ExensioPreCheckService exensioPreCheckService = mock(ExensioPreCheckService.class);

        XfcsController controller = new XfcsController(
                envConfigService, reloadSessionService, archiveSearchService,
                props, envFolderResolver, sseEventBroker, sessionRepo, pendingRepo, exensioPreCheckService);

        @SuppressWarnings("unchecked")
        Map<String, Object> result = (Map<String, Object>) controller.envInfo(envName);
        return result;
    }
}
