package com.onsemi.cim.apps.exensio.xfcsreloader.web.dto;

import java.util.List;

public record ExensioPreCheckResponse(
        List<String> lotsFound,
        List<String> lotsNotFound,
        List<ExensioPreCheckRow> rows,
        String error
) {}
