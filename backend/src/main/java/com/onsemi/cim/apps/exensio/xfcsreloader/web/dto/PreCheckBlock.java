package com.onsemi.cim.apps.exensio.xfcsreloader.web.dto;

import java.util.List;

public record PreCheckBlock(
        Integer year,
        Integer month,
        List<String> lots
) {}
