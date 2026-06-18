package com.onsemi.cim.apps.exensio.xfcsreloader.config;

import com.onsemi.cim.apps.exensio.xfcsreloader.service.EnvConfigService;
import com.onsemi.cim.apps.exensio.xfcsreloader.web.dto.EnvConfCacheInfo;
import org.springframework.boot.actuate.health.Health;
import org.springframework.boot.actuate.health.HealthIndicator;
import org.springframework.stereotype.Component;

@Component
public class EnvConfHealthIndicator implements HealthIndicator {

    private final EnvConfigService envConfigService;

    public EnvConfHealthIndicator(EnvConfigService envConfigService) {
        this.envConfigService = envConfigService;
    }

    @Override
    public Health health() {
        EnvConfCacheInfo info = envConfigService.getCacheInfo();

        boolean healthy = info.envCount() > 0 && (info.fresh() || "LOCAL".equalsIgnoreCase(info.lastSource()));
        Health.Builder builder = healthy ? Health.up() : Health.down();

        return builder
                .withDetail("remoteEnabled", info.remoteEnabled())
                .withDetail("source", info.lastSource())
                .withDetail("fresh", info.fresh())
                .withDetail("ageMs", info.ageMs())
                .withDetail("envCount", info.envCount())
                .withDetail("lastError", info.lastError() == null ? "" : info.lastError())
                .build();
    }
}
