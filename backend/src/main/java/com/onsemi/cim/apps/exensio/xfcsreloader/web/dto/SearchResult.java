package com.onsemi.cim.apps.exensio.xfcsreloader.web.dto;

public record SearchResult(
        String path,
        String lotId,
        String filename,
        Integer year,
        Integer month,
        Long sizeBytes
) {
}
