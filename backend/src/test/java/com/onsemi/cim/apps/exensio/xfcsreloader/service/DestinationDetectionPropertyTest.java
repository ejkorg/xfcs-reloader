package com.onsemi.cim.apps.exensio.xfcsreloader.service;

import com.onsemi.cim.apps.exensio.xfcsreloader.config.ExensioProperties;
import com.onsemi.cim.apps.exensio.xfcsreloader.config.XfcsProperties;
import com.onsemi.cim.apps.exensio.xfcsreloader.entity.ReloadPendingFileEntity;
import com.onsemi.cim.apps.exensio.xfcsreloader.entity.ReloadSessionEntity;
import com.onsemi.cim.apps.exensio.xfcsreloader.entity.ReloadSessionEventEntity;
import com.onsemi.cim.apps.exensio.xfcsreloader.repository.ReloadPendingFileRepository;
import com.onsemi.cim.apps.exensio.xfcsreloader.repository.ReloadSessionEventRepository;
import com.onsemi.cim.apps.exensio.xfcsreloader.repository.ReloadSessionRepository;
import net.jqwik.api.*;
import net.jqwik.api.constraints.AlphaChars;
import net.jqwik.api.constraints.StringLength;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * Property 2: Destination detection round-trip
 * For any completed file whose resolved path contains /production/ or /sandbox/,
 * after the monitor scan cycle the destinationFolder stored in the entity should
 * equal "PRODUCTION" or "SANDBOX" respectively.
 *
 * Property 3: Graceful null destination
 * For any completed file whose resolved path does not contain /production/ or /sandbox/,
 * destinationFolder should be null and no exception should be thrown.
 *
 * Feature: session-log-env-redesign, Property 2: Destination detection round-trip
 * Feature: session-log-env-redesign, Property 3: Graceful null destination
 * Validates: Requirements 2.2, 2.3, 2.4, 2.5
 */
class DestinationDetectionPropertyTest {

    private static final Set<String> TERMINAL_STATUSES = Set.of("completed", "failed", "partially_failed", "cancelled");

    // ── Property 2: Destination detection round-trip ──────────────────────────

    /**
     * Feature: session-log-env-redesign, Property 2: Destination detection round-trip
     * Validates: Requirements 2.2, 2.3, 2.5
     */
    @Property(tries = 100)
    void productionPathResultsInProductionDestination(
            @ForAll @AlphaChars @StringLength(min = 4, max = 12) String prefix,
            @ForAll @AlphaChars @StringLength(min = 4, max = 12) String suffix
    ) throws IOException {
        String fileName = prefix + "_" + suffix + ".dat";
        runScanWithProcessedPath("/etl/envs/PROD1/processed/production/" + fileName, fileName,
                "PRODUCTION");
    }

    /**
     * Feature: session-log-env-redesign, Property 2: Destination detection round-trip
     * Validates: Requirements 2.2, 2.3, 2.5
     */
    @Property(tries = 100)
    void sandboxPathResultsInSandboxDestination(
            @ForAll @AlphaChars @StringLength(min = 4, max = 12) String prefix,
            @ForAll @AlphaChars @StringLength(min = 4, max = 12) String suffix
    ) throws IOException {
        String fileName = prefix + "_" + suffix + ".dat";
        runScanWithProcessedPath("/etl/envs/PROD1/processed/sandbox/" + fileName, fileName,
                "SANDBOX");
    }

    // ── Property 3: Graceful null destination ─────────────────────────────────

    /**
     * Feature: session-log-env-redesign, Property 3: Graceful null destination
     * Validates: Requirements 2.4
     */
    @Property(tries = 100)
    void pathWithoutKeywordResultsInNullDestination(
            @ForAll @AlphaChars @StringLength(min = 4, max = 12) String segment,
            @ForAll @AlphaChars @StringLength(min = 4, max = 12) String fileName
    ) throws IOException {
        // Path contains neither /production/ nor /sandbox/
        String path = "/etl/envs/PROD1/processed/" + segment + "/" + fileName + ".dat";
        runScanWithProcessedPath(path, fileName + ".dat", null);
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    /**
     * Sets up a real temp directory tree matching the given processedPath,
     * runs scanPendingFiles(), and asserts the captured entity's destinationFolder.
     */
    private void runScanWithProcessedPath(String processedPath, String fileName, String expectedDestination)
            throws IOException {

        // Create a real temp file at the processedPath so findFileRecursively can find it
        Path tempFile = Files.createTempFile("xfcs-test-" + fileName.replace(".dat", ""), ".dat");
        tempFile.toFile().deleteOnExit();

        // Build a path string that contains the destination keyword and ends with the fileName
        // We use the temp file's actual path but we need the foundStr to contain the keyword.
        // Since findFileRecursively uses the real FS, we create a temp dir tree that matches.
        Path tempDir = Files.createTempDirectory("xfcs-scan-test");
        tempDir.toFile().deleteOnExit();

        // Build subdirectory matching the destination segment
        String[] segments = processedPath.split("/");
        Path current = tempDir;
        for (int i = 1; i < segments.length - 1; i++) {
            current = current.resolve(segments[i]);
        }
        Files.createDirectories(current);
        Path actualFile = current.resolve(fileName);
        Files.createFile(actualFile);
        actualFile.toFile().deleteOnExit();

        // The absPath stored in the entity is the inbox root path (not the processed path).
        // We use the tempDir as the "inbox root" so findFileRecursively searches from there.
        String absPath = tempDir.resolve(fileName).toString();

        String sessionId = UUID.randomUUID().toString();

        ReloadSessionRepository sessionRepo = Mockito.mock(ReloadSessionRepository.class);
        ReloadSessionEventRepository eventRepo = Mockito.mock(ReloadSessionEventRepository.class);
        ReloadPendingFileRepository pendingRepo = Mockito.mock(ReloadPendingFileRepository.class);
        SseEventBroker sseEventBroker = Mockito.mock(SseEventBroker.class);
        EnvFolderResolver envFolderResolver = Mockito.mock(EnvFolderResolver.class);

        ReloadPendingFileEntity pf = new ReloadPendingFileEntity();
        pf.setAbsPath(absPath);
        pf.setSessionId(sessionId);
        pf.setFileName(fileName);
        pf.setEnvironment("PROD1");
        pf.setRequester("tester");
        pf.setCreatedAt(Instant.now());
        pf.setFileStatus("pending");

        ReloadSessionEntity session = new ReloadSessionEntity();
        session.setSessionId(sessionId);
        session.setStatus("processing");
        session.setCreatedAt(Instant.now());

        when(pendingRepo.findAll()).thenReturn(List.of(pf));
        when(sessionRepo.findAllById(any())).thenReturn(List.of(session));
        when(sessionRepo.findAll()).thenReturn(List.of());
        when(sessionRepo.findById(sessionId)).thenReturn(Optional.of(session));
        when(pendingRepo.countBySessionId(sessionId)).thenReturn(0L);
        when(eventRepo.findBySessionId(sessionId)).thenReturn(List.of());

        ReloadSessionEventEntity savedEvent = new ReloadSessionEventEntity();
        savedEvent.setId(1L);
        savedEvent.setSessionId(sessionId);
        savedEvent.setEventType("file_completed");
        savedEvent.setEventTime(Instant.now());
        when(eventRepo.save(any())).thenReturn(savedEvent);

        // Resolve inbox to the tempDir so findFileRecursively searches from there
        when(envFolderResolver.resolveInboxFolder("PROD1")).thenReturn(tempDir);

        XfcsProperties props = new XfcsProperties();
        props.setStuckSessionTimeoutMin(60);
        ExensioProperties exensioProps = new ExensioProperties();
        exensioProps.setEnabled(false);
        ReloadPendingMonitor monitor = new ReloadPendingMonitor(
                sessionRepo, eventRepo, pendingRepo, sseEventBroker, props, envFolderResolver, exensioProps, null);

        // Act — should not throw
        monitor.scanPendingFiles();

        // Assert — capture the saved entity and check destinationFolder
        ArgumentCaptor<ReloadPendingFileEntity> captor = ArgumentCaptor.forClass(ReloadPendingFileEntity.class);
        verify(pendingRepo, atLeastOnce()).save(captor.capture());

        // Find the save call where fileStatus was set to "completed"
        ReloadPendingFileEntity saved = captor.getAllValues().stream()
                .filter(e -> "completed".equals(e.getFileStatus()))
                .findFirst()
                .orElse(null);

        assertThat(saved).as("Entity should have been saved with status=completed").isNotNull();
        assertThat(saved.getDestinationFolder())
                .as("destinationFolder should be '%s' for path '%s'", expectedDestination, actualFile)
                .isEqualTo(expectedDestination);

        // Cleanup
        Files.deleteIfExists(actualFile);
        deleteRecursively(tempDir);
    }

    private void deleteRecursively(Path dir) {
        try {
            if (Files.isDirectory(dir)) {
                try (var stream = Files.list(dir)) {
                    stream.forEach(this::deleteRecursively);
                }
            }
            Files.deleteIfExists(dir);
        } catch (IOException ignored) {}
    }
}
