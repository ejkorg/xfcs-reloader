package com.onsemi.cim.apps.exensio.xfcsreloader.web.dto;

public record EnvYearRange(
        String environment,
        String dbCode,
        String siteName,
        String siteCode,
        String areaCode,
        String testerType,
        String parentGroup,
        String regionGroup,
        String processGroup,
        String folder,
        int startYear,
        int endYear,
        boolean active
) {
}
