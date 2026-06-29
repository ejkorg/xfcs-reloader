package com.onsemi.cim.apps.exensio.xfcsreloader.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.jdbc.DataSourceBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;

import javax.sql.DataSource;

/**
 * Primary DataSource configuration. Explicitly defines the primary datasource
 * to prevent Spring Boot auto-configuration from picking up Snowflake JDBC
 * as an alternative datasource.
 *
 * When the 'onsemi-oracle' profile is active, this bean is created with
 * Oracle connection properties. Otherwise, uses H2 (from application.yml).
 *
 * The Snowflake datasource is configured separately in SnowflakeDataSourceConfig
 * as a secondary, non-primary bean.
 */
@Configuration
public class DataSourceConfig {

    @Bean
    @Primary
    @ConfigurationProperties(prefix = "spring.datasource")
    public DataSource primaryDataSource() {
        return DataSourceBuilder.create().build();
    }
}
