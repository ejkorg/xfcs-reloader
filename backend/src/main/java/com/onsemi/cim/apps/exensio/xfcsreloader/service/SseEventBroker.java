package com.onsemi.cim.apps.exensio.xfcsreloader.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.onsemi.cim.apps.exensio.xfcsreloader.entity.ReloadSessionEventEntity;
import com.onsemi.cim.apps.exensio.xfcsreloader.repository.ReloadSessionEventRepository;
import com.onsemi.cim.apps.exensio.xfcsreloader.web.dto.ReloadSessionEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Manages SSE emitters for reload session streams.
 * Provides subscribe/publish/complete lifecycle for per-session SSE connections.
 */
@Component
public class SseEventBroker {

    private static final Logger log = LoggerFactory.getLogger(SseEventBroker.class);
    private static final long EMITTER_TIMEOUT_MS = 5 * 60 * 1000L; // 5 minutes

    private final ConcurrentHashMap<String, CopyOnWriteArrayList<SseEmitter>> emitters =
            new ConcurrentHashMap<>();

    private final ReloadSessionEventRepository eventRepository;
    private final ObjectMapper objectMapper;

    public SseEventBroker(ReloadSessionEventRepository eventRepository, ObjectMapper objectMapper) {
        this.eventRepository = eventRepository;
        this.objectMapper = objectMapper;
    }

    /**
     * Creates a new SSE subscription for the given session.
     * Replays all events with id > lastEventId before returning the emitter.
     */
    public SseEmitter subscribe(String sessionId, Long lastEventId) {
        SseEmitter emitter = new SseEmitter(EMITTER_TIMEOUT_MS);
        CopyOnWriteArrayList<SseEmitter> sessionEmitters =
                emitters.computeIfAbsent(sessionId, k -> new CopyOnWriteArrayList<>());
        sessionEmitters.add(emitter);

        // Clean up on completion/timeout/error
        Runnable cleanup = () -> {
            CopyOnWriteArrayList<SseEmitter> list = emitters.get(sessionId);
            if (list != null) list.remove(emitter);
        };
        emitter.onCompletion(cleanup);
        emitter.onTimeout(cleanup);
        emitter.onError(e -> cleanup.run());

        // Replay missed events
        long replayFrom = lastEventId != null ? lastEventId : 0L;
        if (replayFrom >= 0) {
            try {
                List<ReloadSessionEventEntity> missed = eventRepository
                        .findBySessionIdOrderByEventTimeAsc(sessionId)
                        .stream()
                        .filter(e -> e.getId() != null && e.getId() > replayFrom)
                        .toList();

                for (ReloadSessionEventEntity entity : missed) {
                    sendToEmitter(emitter, toDto(entity));
                }
            } catch (Exception e) {
                log.warn("[SseBroker] Failed to replay events for session {}: {}", sessionId, e.getMessage());
            }
        }

        log.debug("[SseBroker] New subscriber for session {}. Total: {}", sessionId, sessionEmitters.size());
        return emitter;
    }

    /**
     * Publishes an event to all active SSE subscribers for the given session.
     */
    public void publish(String sessionId, ReloadSessionEvent event) {
        CopyOnWriteArrayList<SseEmitter> sessionEmitters = emitters.get(sessionId);
        if (sessionEmitters == null || sessionEmitters.isEmpty()) return;

        for (SseEmitter emitter : sessionEmitters) {
            sendToEmitter(emitter, event);
        }
    }

    /**
     * Sends a SESSION_TERMINAL event and closes all emitters for the session.
     */
    public void complete(String sessionId) {
        CopyOnWriteArrayList<SseEmitter> sessionEmitters = emitters.remove(sessionId);
        if (sessionEmitters == null) return;

        ReloadSessionEvent terminal = new ReloadSessionEvent(
                null, sessionId, Instant.now(), "SESSION_TERMINAL",
                "Session has reached a terminal state", "SYSTEM", null
        );

        for (SseEmitter emitter : sessionEmitters) {
            sendToEmitter(emitter, terminal);
            try {
                emitter.complete();
            } catch (Exception ignored) {}
        }
        log.debug("[SseBroker] Completed all emitters for session {}", sessionId);
    }

    private void sendToEmitter(SseEmitter emitter, ReloadSessionEvent event) {
        try {
            String json = objectMapper.writeValueAsString(event);
            SseEmitter.SseEventBuilder builder = SseEmitter.event().data(json);
            if (event.id() != null) {
                builder = builder.id(String.valueOf(event.id()));
            }
            emitter.send(builder);
        } catch (IOException e) {
            // Dead emitter — will be cleaned up by onError/onCompletion callbacks
            log.debug("[SseBroker] Failed to send to emitter (likely closed): {}", e.getMessage());
        } catch (Exception e) {
            log.warn("[SseBroker] Unexpected error sending SSE event: {}", e.getMessage());
        }
    }

    private ReloadSessionEvent toDto(ReloadSessionEventEntity entity) {
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
}
