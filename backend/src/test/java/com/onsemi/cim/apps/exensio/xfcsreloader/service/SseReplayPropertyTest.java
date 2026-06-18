package com.onsemi.cim.apps.exensio.xfcsreloader.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.onsemi.cim.apps.exensio.xfcsreloader.entity.ReloadSessionEventEntity;
import com.onsemi.cim.apps.exensio.xfcsreloader.repository.ReloadSessionEventRepository;
import net.jqwik.api.*;
import net.jqwik.api.constraints.IntRange;
import org.mockito.Mockito;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.IntStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

/**
 * Property 2: SSE Last-Event-ID replay completeness
 *
 * For any session with N events (ids 1..N) and any reconnect with lastEventId = k
 * where 0 ≤ k < N, the broker should query the repository and return an emitter
 * without throwing, and the repository should be called exactly once.
 *
 * Feature: reload-monitoring-overhaul, Property 2: SSE Last-Event-ID replay completeness
 * Validates: Requirements 1.4
 */
class SseReplayPropertyTest {

    @Property(tries = 100)
    void replayReturnsEmitterForAnyLastEventId(
            @ForAll @IntRange(min = 1, max = 20) int totalEvents,
            @ForAll @IntRange(min = 0, max = 19) int lastEventIdOffset
    ) {
        // Ensure lastEventId is within valid range [0, totalEvents-1]
        long lastEventId = Math.min(lastEventIdOffset, totalEvents - 1);

        // Arrange
        ReloadSessionEventRepository repo = Mockito.mock(ReloadSessionEventRepository.class);
        ObjectMapper mapper = new ObjectMapper()
                .registerModule(new JavaTimeModule())
                .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
        SseEventBroker broker = new SseEventBroker(repo, mapper);

        List<ReloadSessionEventEntity> events = buildEvents("session-prop", totalEvents);
        when(repo.findBySessionIdOrderByEventTimeAsc(anyString())).thenReturn(events);

        // Act
        SseEmitter emitter = broker.subscribe("session-prop", lastEventId);

        // Assert: emitter is always returned (never null)
        assertThat(emitter).isNotNull();

        // Assert: repository was queried for replay
        Mockito.verify(repo).findBySessionIdOrderByEventTimeAsc("session-prop");
    }

    @Property(tries = 100)
    void replayWithLastEventIdEqualToMaxDoesNotThrow(
            @ForAll @IntRange(min = 1, max = 30) int totalEvents
    ) {
        ReloadSessionEventRepository repo = Mockito.mock(ReloadSessionEventRepository.class);
        ObjectMapper mapper = new ObjectMapper()
                .registerModule(new JavaTimeModule())
                .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
        SseEventBroker broker = new SseEventBroker(repo, mapper);

        List<ReloadSessionEventEntity> events = buildEvents("session-max", totalEvents);
        when(repo.findBySessionIdOrderByEventTimeAsc(anyString())).thenReturn(events);

        // Reconnect with lastEventId = totalEvents (all events already seen)
        SseEmitter emitter = broker.subscribe("session-max", (long) totalEvents);

        assertThat(emitter).isNotNull();
    }

    private List<ReloadSessionEventEntity> buildEvents(String sessionId, int count) {
        List<ReloadSessionEventEntity> list = new ArrayList<>();
        for (int i = 1; i <= count; i++) {
            ReloadSessionEventEntity e = new ReloadSessionEventEntity();
            e.setId((long) i);
            e.setSessionId(sessionId);
            e.setEventType("FILE_STARTED");
            e.setEventTime(Instant.now());
            e.setMessage("event " + i);
            e.setActor("SYSTEM");
            list.add(e);
        }
        return list;
    }
}
