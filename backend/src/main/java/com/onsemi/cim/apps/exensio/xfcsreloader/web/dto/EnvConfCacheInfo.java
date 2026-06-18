package com.onsemi.cim.apps.exensio.xfcsreloader.web.dto;

public record EnvConfCacheInfo(
        boolean remoteEnabled,
        String lastSource,
        long cacheTtlSec,
        boolean fresh,
        long ageMs,
        String fetchedAt,
        String lastError,
        int envCount
) {
}
