package com.onsemi.cim.apps.exensio.xfcsreloader.web.dto;

import java.time.Instant;

public record FileStatusDto(
        String absPath,
        String fileName,
        String originalFileName,
        String userLotId,
        String fileStatus,
        String errorReason,
        String resolvedPath,
        String destinationFolder,
        Instant createdAt,
        Instant resolvedAt
) {}
