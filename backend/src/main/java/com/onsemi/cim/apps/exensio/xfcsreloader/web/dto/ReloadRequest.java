package com.onsemi.cim.apps.exensio.xfcsreloader.web.dto;

import java.util.List;

public record ReloadRequest(
        String environment,
        String site,
        String area,
        String testerType,
        String requester,
        List<String> filePaths,
        List<ReloadFileItem> files
) {
    public record ReloadFileItem(String path, String userLotId) {}
}
