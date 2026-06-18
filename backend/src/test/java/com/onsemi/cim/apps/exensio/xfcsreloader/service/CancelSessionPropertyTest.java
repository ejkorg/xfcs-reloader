package com.onsemi.cim.apps.exensio.xfcsreloader.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.onsemi.cim.apps.exensio.xfcsreloader.entity.ReloadPendingFileEntity;
import com.onsemi.cim.apps.exensio.xfcsreloader.entity.ReloadSessionEntity;
import com.onsemi.cim.apps.exensio.xfcsreloader.entity.ReloadSessionEventEntity;
import com.onsemi.cim.apps.exensio.xfcsreloader.repository.ReloadPendingFileRepository;
import com.onsemi.cim.apps.exensio.xfcsreloader.repository.ReloadSessionEventRepository;
import com.onsemi.cim.apps.exensio.xfcsreloader.repository.ReloadSessionRepository;
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
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * Property 6: Cancel idempotency on terminal sessions
 * Property 7: Cancel cleans up pending files
 *
 * Feature: reload-monitoring-overhaul
 * Validates: Requirements 6.2, 6.4
 */
class CancelSessionPropertyTest {

    private static final List<String> TERMINAL_STATUSES =
            List.of("completed", "failed", "partially_failed", "cancelled");

    /**
     * Property 6: For any session already in a Terminal_Status, calling cancelSession
     * should throw SessionAlreadyTerminalException and leave the session unchanged.
     * Validates: Requirements 6.4
     */
    @Property(tries = 100)
    void cancelOnTerminalSessionThrows409(
            @ForAll("terminalStatus") String terminalStatus
    ) {
        ReloadSessionRepository sessionRepo = Mockito.mock(ReloadSessionRepository.class);
        ReloadSessionEventRepository eventRepo = Mockito.mock(ReloadSessionEventRepository.class);
        ReloadPendingFileRepository pendingRepo = Mockito.mock(ReloadPendingFileRepository.class);
        SseEventBroker broker = Mockito.mock(SseEventBroker.class);

        String sessionId = UUID.randomUUID().toString();
        ReloadSessionEntity session = buildSession(sessionId, terminalStatus);
        when(sessionRepo.findById(sessionId)).thenReturn(Optional.of(session));

        ReloadSessionService service = buildService(sessionRepo, eventRepo, pendingRepo, broker);

        // Act + Assert: should throw SessionAlreadyTerminalException
        assertThatThrownBy(() -> service.cancelSession(sessionId))
                .isInstanceOf(ReloadSessionService.SessionAlreadyTerminalException.class);

        // Session must not be modified
        verify(sessionRepo, never()).save(any());
        verify(broker, never()).complete(anyString());
    }

    /**
     * Property 7: For any non-terminal session with P pending files, after a successful cancel:
     * - session status must be "cancelled"
     * - SESSION_CANCELLED event must be appended
     * - all pending files must be deleted
     * Validates: Requirements 6.2
     */
    @Property(tries = 100)
    void cancelNonTerminalSessionCleansUp(
            @ForAll("nonTerminalStatus") String nonTerminalStatus,
            @ForAll @IntRange(min = 0, max = 5) int pendingFileCount
    ) {
        ReloadSessionRepository sessionRepo = Mockito.mock(ReloadSessionRepository.class);
        ReloadSessionEventRepository eventRepo = Mockito.mock(ReloadSessionEventRepository.class);
        ReloadPendingFileRepository pendingRepo = Mockito.mock(ReloadPendingFileRepository.class);
        SseEventBroker broker = Mockito.mock(SseEventBroker.class);

        String sessionId = UUID.randomUUID().toString();
        ReloadSessionEntity session = buildSession(sessionId, nonTerminalStatus);
        when(sessionRepo.findById(sessionId)).thenReturn(Optional.of(session));

        // Mock the event save
        ReloadSessionEventEntity savedEvent = new ReloadSessionEventEntity();
        savedEvent.setId(1L);
        savedEvent.setSessionId(sessionId);
        savedEvent.setEventType("SESSION_CANCELLED");
        savedEvent.setEventTime(Instant.now());
        when(eventRepo.save(any())).thenReturn(savedEvent);

        ReloadSessionService service = buildService(sessionRepo, eventRepo, pendingRepo, broker);

        // Act
        service.cancelSession(sessionId);

        // Assert: session saved with "cancelled" status
        ArgumentCaptor<ReloadSessionEntity> captor = ArgumentCaptor.forClass(ReloadSessionEntity.class);
        verify(sessionRepo).save(captor.capture());
        assertThat(captor.getValue().getStatus()).isEqualTo("cancelled");
        assertThat(captor.getValue().getCompletedAt()).isNotNull();

        // Assert: SESSION_CANCELLED event appended
        ArgumentCaptor<ReloadSessionEventEntity> eventCaptor = ArgumentCaptor.forClass(ReloadSessionEventEntity.class);
        verify(eventRepo).save(eventCaptor.capture());
        assertThat(eventCaptor.getValue().getEventType()).isEqualTo("SESSION_CANCELLED");

        // Assert: pending files deleted by sessionId
        verify(pendingRepo).deleteBySessionId(sessionId);

        // Assert: SSE stream completed
        verify(broker).complete(sessionId);
    }

    @Provide
    Arbitrary<String> terminalStatus() {
        return Arbitraries.of(TERMINAL_STATUSES);
    }

    @Provide
    Arbitrary<String> nonTerminalStatus() {
        return Arbitraries.of("created", "processing", "running");
    }

    private ReloadSessionEntity buildSession(String sessionId, String status) {
        ReloadSessionEntity s = new ReloadSessionEntity();
        s.setSessionId(sessionId);
        s.setStatus(status);
        s.setCreatedAt(Instant.now());
        return s;
    }

    private ReloadSessionService buildService(
            ReloadSessionRepository sessionRepo,
            ReloadSessionEventRepository eventRepo,
            ReloadPendingFileRepository pendingRepo,
            SseEventBroker broker
    ) {
        ObjectMapper mapper = new ObjectMapper()
                .registerModule(new JavaTimeModule())
                .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
        ReloadExecutionService execService = Mockito.mock(ReloadExecutionService.class);
        return new ReloadSessionService(sessionRepo, eventRepo, pendingRepo, execService, broker, mapper);
    }
}
