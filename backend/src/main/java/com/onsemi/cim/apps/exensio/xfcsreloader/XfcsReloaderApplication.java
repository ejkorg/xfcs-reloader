package com.onsemi.cim.apps.exensio.xfcsreloader;

import com.onsemi.cim.apps.exensio.xfcsreloader.config.XfcsProperties;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableConfigurationProperties(XfcsProperties.class)
@EnableScheduling
public class XfcsReloaderApplication {
    public static void main(String[] args) {
        SpringApplication.run(XfcsReloaderApplication.class, args);
    }
}
