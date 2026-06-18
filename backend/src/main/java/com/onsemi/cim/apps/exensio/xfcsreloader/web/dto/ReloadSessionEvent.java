package com.onsemi.cim.apps.exensio.xfcsreloader.web.dto;

import java.time.Instant;

public record ReloadSessionEvent(
        Long id,
        String sessionId,
        Instant eventTime,
        String eventType,
        String message,
        String actor,
        String errorCode
) {
}
