package com.onsemi.cim.apps.exensio.xfcsreloader.web.dto;

public record ArchiveLotDetail(
        String lot,
        String wafer,
        String filename,
        Integer year,
        Integer month,
        String archivePath,
        String status,
        String processingStatus,
        String environment,
        String error,
        Long processedAt
) {
}
