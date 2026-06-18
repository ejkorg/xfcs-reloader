package com.onsemi.cim.apps.exensio.xfcsreloader.web.dto;

import java.time.Instant;

public record ReloadStatus(
        String sessionId,
        String status,
        String message,
        String requester,
        String environment,
        Instant createdAt,
        Instant updatedAt,
        int totalFiles,
        int completedFiles,
        int failedFiles,
        java.util.List<String> filePaths,
        java.util.List<ReloadRequest.ReloadFileItem> files
) {
}
