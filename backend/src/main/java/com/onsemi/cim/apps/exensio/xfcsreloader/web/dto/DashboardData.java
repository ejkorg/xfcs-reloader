package com.onsemi.cim.apps.exensio.xfcsreloader.web.dto;

import java.util.List;

public record DashboardData(
        String generatedAt,
        int totalRequests,
        int completed,
        int failed,
        List<String> recentLots,
        int activeSessions,
        int pendingFiles,
        int stuckTimeoutMin
) {}
