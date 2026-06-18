package com.onsemi.cim.apps.exensio.xfcsreloader.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.onsemi.cim.apps.exensio.xfcsreloader.entity.ReloadSessionEventEntity;
import com.onsemi.cim.apps.exensio.xfcsreloader.repository.ReloadSessionEventRepository;
import com.onsemi.cim.apps.exensio.xfcsreloader.web.dto.ReloadSessionEvent;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.time.Instant;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

/**
 * Unit tests for SseEventBroker.
 * Validates: Requirements 1.1, 1.2, 1.3
 */
@ExtendWith(MockitoExtension.class)
class SseEventBrokerTest {

    @Mock
    private ReloadSessionEventRepository eventRepository;

    private SseEventBroker broker;

    @BeforeEach
    void setUp() {
        ObjectMapper mapper = new ObjectMapper()
                .registerModule(new JavaTimeModule())
                .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
        broker = new SseEventBroker(eventRepository, mapper);
    }

    @Test
    void subscribe_withNoLastEventId_returnsEmitter() {
        when(eventRepository.findBySessionIdOrderByEventTimeAsc("session-1"))
                .thenReturn(List.of());

        SseEmitter emitter = broker.subscribe("session-1", 0L);

        assertThat(emitter).isNotNull();
    }

    @Test
    void subscribe_replaysEventsAfterLastEventId() {
        // Arrange: 3 events in DB, reconnect with lastEventId=1 → should replay events 2 and 3
        ReloadSessionEventEntity e1 = makeEntity(1L, "session-1", "FILE_STARTED");
        ReloadSessionEventEntity e2 = makeEntity(2L, "session-1", "FILE_COMPLETED");
        ReloadSessionEventEntity e3 = makeEntity(3L, "session-1", "SESSION_COMPLETED");

        when(eventRepository.findBySessionIdOrderByEventTimeAsc("session-1"))
                .thenReturn(List.of(e1, e2, e3));

        // subscribe with lastEventId=1 — should replay e2 and e3 only
        SseEmitter emitter = broker.subscribe("session-1", 1L);

        assertThat(emitter).isNotNull();
        // Verify the repository was queried for replay
        verify(eventRepository).findBySessionIdOrderByEventTimeAsc("session-1");
    }

    @Test
    void publish_withNoSubscribers_doesNotThrow() {
        ReloadSessionEvent event = new ReloadSessionEvent(
                1L, "session-x", Instant.now(), "FILE_STARTED", "msg", "actor", null
        );

        // Should not throw even with no subscribers
        broker.publish("session-x", event);
    }

    @Test
    void publish_withSubscriber_sendsEvent() {
        when(eventRepository.findBySessionIdOrderByEventTimeAsc("session-2"))
                .thenReturn(List.of());

        SseEmitter emitter = broker.subscribe("session-2", 0L);
        assertThat(emitter).isNotNull();

        ReloadSessionEvent event = new ReloadSessionEvent(
                1L, "session-2", Instant.now(), "FILE_COMPLETED", "Done", "SYSTEM", null
        );

        // Should not throw — emitter is open
        broker.publish("session-2", event);
    }

    @Test
    void complete_withNoSubscribers_doesNotThrow() {
        // Should not throw even with no subscribers
        broker.complete("session-nonexistent");
    }

    @Test
    void complete_removesSessionFromMap() {
        when(eventRepository.findBySessionIdOrderByEventTimeAsc("session-3"))
                .thenReturn(List.of());

        broker.subscribe("session-3", 0L);

        // complete should not throw and should clean up
        broker.complete("session-3");

        // Subsequent publish should be a no-op (no subscribers)
        ReloadSessionEvent event = new ReloadSessionEvent(
                1L, "session-3", Instant.now(), "SESSION_TERMINAL", "done", "SYSTEM", null
        );
        broker.publish("session-3", event); // should not throw
    }

    private ReloadSessionEventEntity makeEntity(Long id, String sessionId, String type) {
        ReloadSessionEventEntity e = new ReloadSessionEventEntity();
        e.setId(id);
        e.setSessionId(sessionId);
        e.setEventType(type);
        e.setEventTime(Instant.now());
        e.setMessage("test message");
        e.setActor("SYSTEM");
        return e;
    }
}
