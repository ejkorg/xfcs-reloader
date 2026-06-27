package com.onsemi.cim.apps.exensio.xfcsreloader.web.dto;

import java.util.List;

public record ExensioPreCheckRequest(
        String environment,
        List<String> lotIds,
        List<PreCheckBlock> blocks
) {}
