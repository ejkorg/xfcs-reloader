package com.onsemi.cim.apps.exensio.xfcsreloader.web.dto;

import java.util.List;

public record SearchCriteria(
        String environment,
        String site,
        String area,
        String testerType,
        List<Integer> years,
        List<Integer> months,
        List<String> lotIds,
        Integer maxResults
) {
}
