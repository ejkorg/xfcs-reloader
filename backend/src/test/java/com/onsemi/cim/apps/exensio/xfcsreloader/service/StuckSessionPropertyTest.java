package com.onsemi.cim.apps.exensio.xfcsreloader.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.onsemi.cim.apps.exensio.xfcsreloader.config.ExensioProperties;
import com.onsemi.cim.apps.exensio.xfcsreloader.config.XfcsProperties;
import com.onsemi.cim.apps.exensio.xfcsreloader.entity.ReloadPendingFileEntity;
import com.onsemi.cim.apps.exensio.xfcsreloader.entity.ReloadSessionEntity;
import com.onsemi.cim.apps.exensio.xfcsreloader.entity.ReloadSessionEventEntity;
import com.onsemi.cim.apps.exensio.xfcsreloader.repository.ReloadPendingFileRepository;
import com.onsemi.cim.apps.exensio.xfcsreloader.repository.ReloadSessionEventRepository;
import com.onsemi.cim.apps.exensio.xfcsreloader.repository.ReloadSessionRepository;
import com.onsemi.cim.apps.exensio.xfcsreloader.service.EnvFolderResolver;
import net.jqwik.api.*;
import net.jqwik.api.constraints.IntRange;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Property 5: Stuck-session cleanup invariant
 *
 * For any session that has been in a non-terminal state for longer than stuckTimeoutMin
 * minutes with no pending-file resolution, after one scan cycle:
 *   - session status must be "failed"
 *   - completedAt must be set
 *   - a SESSION_TIMED_OUT event must be appended
 *   - pending files for that session must be deleted
 *
 * Feature: reload-monitoring-overhaul, Property 5: Stuck-session cleanup invariant
 * Validates: Requirements 3.1, 3.2, 3.3
 */
class StuckSessionPropertyTest {

    @Property(tries = 100)
    void stuckSessionIsMarkedFailedAfterTimeout(
            @ForAll @IntRange(min = 1, max = 120) int timeoutMin,
            @ForAll @IntRange(min = 1, max = 5) int pendingFileCount
    ) {
        // Arrange
        ReloadSessionRepository sessionRepo = Mockito.mock(ReloadSessionRepository.class);
        ReloadSessionEventRepository eventRepo = Mockito.mock(ReloadSessionEventRepository.class);
        ReloadPendingFileRepository pendingRepo = Mockito.mock(ReloadPendingFileRepository.class);
        SseEventBroker broker = Mockito.mock(SseEventBroker.class);

        XfcsProperties props = new XfcsProperties();
        props.setStuckSessionTimeoutMin(timeoutMin);
        EnvFolderResolver envFolderResolver = Mockito.mock(EnvFolderResolver.class);

        ExensioProperties exensioProps = new ExensioProperties();
        exensioProps.setEnabled(false);
        ReloadPendingMonitor monitor = new ReloadPendingMonitor(
                sessionRepo, eventRepo, pendingRepo, broker, props, envFolderResolver, exensioProps, null
        );

        String sessionId = UUID.randomUUID().toString();

        // Session created well before the timeout cutoff
        ReloadSessionEntity session = new ReloadSessionEntity();
        session.setSessionId(sessionId);
        session.setStatus("processing");
        session.setCreatedAt(Instant.now().minusSeconds((long) (timeoutMin + 1) * 60));

        when(sessionRepo.findAll()).thenReturn(List.of(session));
        when(sessionRepo.findById(sessionId)).thenReturn(Optional.of(session));

        // Pending files for this session
        List<ReloadPendingFileEntity> pendingFiles = buildPendingFiles(sessionId, pendingFileCount);
        when(pendingRepo.findBySessionId(sessionId)).thenReturn(pendingFiles);

        ReloadSessionEventEntity savedEvent = new ReloadSessionEventEntity();
        savedEvent.setId(1L);
        savedEvent.setSessionId(sessionId);
        savedEvent.setEventType("SESSION_TIMED_OUT");
        savedEvent.setEventTime(Instant.now());
        when(eventRepo.save(any())).thenReturn(savedEvent);

        // Act
        monitor.checkStuckSessions();

        // Assert: session was saved with "failed" status
        ArgumentCaptor<ReloadSessionEntity> sessionCaptor = ArgumentCaptor.forClass(ReloadSessionEntity.class);
        verify(sessionRepo).save(sessionCaptor.capture());
        assertThat(sessionCaptor.getValue().getStatus()).isEqualTo("failed");
        assertThat(sessionCaptor.getValue().getCompletedAt()).isNotNull();

        // Assert: SESSION_TIMED_OUT event was appended
        ArgumentCaptor<ReloadSessionEventEntity> eventCaptor = ArgumentCaptor.forClass(ReloadSessionEventEntity.class);
        verify(eventRepo).save(eventCaptor.capture());
        assertThat(eventCaptor.getValue().getEventType()).isEqualTo("SESSION_TIMED_OUT");

        // Assert: all pending files were deleted
        for (ReloadPendingFileEntity pf : pendingFiles) {
            verify(pendingRepo).deleteById(pf.getAbsPath());
        }

        // Assert: SSE stream was completed
        verify(broker).complete(sessionId);
    }

    @Property(tries = 50)
    void timeoutZeroDisablesStuckSessionCheck(
            @ForAll @IntRange(min = 1, max = 5) int pendingFileCount
    ) {
        ReloadSessionRepository sessionRepo = Mockito.mock(ReloadSessionRepository.class);
        ReloadSessionEventRepository eventRepo = Mockito.mock(ReloadSessionEventRepository.class);
        ReloadPendingFileRepository pendingRepo = Mockito.mock(ReloadPendingFileRepository.class);
        SseEventBroker broker = Mockito.mock(SseEventBroker.class);

        XfcsProperties props = new XfcsProperties();
        props.setStuckSessionTimeoutMin(0); // disabled
        EnvFolderResolver envFolderResolver = Mockito.mock(EnvFolderResolver.class);

        ExensioProperties exensioProps = new ExensioProperties();
        exensioProps.setEnabled(false);
        ReloadPendingMonitor monitor = new ReloadPendingMonitor(
                sessionRepo, eventRepo, pendingRepo, broker, props, envFolderResolver, exensioProps, null
        );

        // Act
        monitor.checkStuckSessions();

        // Assert: no sessions were queried, no changes made
        verify(sessionRepo, never()).findAll();
        verify(sessionRepo, never()).save(any());
        verify(broker, never()).complete(anyString());
    }

    private List<ReloadPendingFileEntity> buildPendingFiles(String sessionId, int count) {
        List<ReloadPendingFileEntity> list = new ArrayList<>();
        for (int i = 0; i < count; i++) {
            ReloadPendingFileEntity pf = new ReloadPendingFileEntity();
            pf.setAbsPath("/inbox/file_" + i + ".dat");
            pf.setSessionId(sessionId);
            pf.setFileName("file_" + i + ".dat");
            pf.setCreatedAt(Instant.now());
            list.add(pf);
        }
        return list;
    }
}
