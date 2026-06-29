package com.onsemi.cim.apps.exensio.xfcsreloader.config;

import org.springframework.boot.autoconfigure.jdbc.DataSourceProperties;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;

import javax.sql.DataSource;

/**
 * Primary DataSource configuration. Explicitly defines the primary datasource
 * to prevent Spring Boot auto-configuration from picking up Snowflake JDBC
 * as an alternative datasource.
 *
 * <p>Uses {@link DataSourceProperties} to properly translate
 * {@code spring.datasource.url} into HikariCP's required {@code jdbcUrl}.
 * Direct use of {@code DataSourceBuilder} with {@code @ConfigurationProperties}
 * skips this translation, causing "jdbcUrl is required with driverClassName".
 *
 * <p>When the 'onsemi-oracle' profile is active, this bean is created with
 * Oracle connection properties. Otherwise, uses H2 (from application.yml).
 *
 * <p>The Snowflake datasource is configured separately in SnowflakeDataSourceConfig
 * as a secondary, non-primary bean.
 */
@Configuration
public class DataSourceConfig {

    @Bean
    @Primary
    @ConfigurationProperties(prefix = "spring.datasource")
    public DataSourceProperties primaryDataSourceProperties() {
        return new DataSourceProperties();
    }

    @Bean
    @Primary
    public DataSource primaryDataSource(DataSourceProperties primaryDataSourceProperties) {
        return primaryDataSourceProperties.initializeDataSourceBuilder().build();
    }
}
