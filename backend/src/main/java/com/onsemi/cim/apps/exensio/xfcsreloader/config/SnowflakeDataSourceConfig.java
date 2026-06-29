package com.onsemi.cim.apps.exensio.xfcsreloader.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

import javax.sql.DataSource;

/**
 * Configures a dedicated DataSource for Snowflake JDBC connections used by the
 * Exensio pre-check feature. Credentials are supplied via the SNOW_USER and
 * SNOW_PASS environment variables; the URL is read from snowflake.url.
 *
 * This DataSource is intentionally separate from the primary Spring DataSource
 * so that Snowflake availability does not affect the main application startup.
 *
 * NOTE: This bean is NOT the primary datasource and should NOT be used by
 * Liquibase, Hibernate, or other ORM/migration tools. It is used only for
 * ad-hoc JDBC queries in the pre-check feature.
 */
@Configuration
@ConditionalOnProperty(name = "snowflake.url", matchIfMissing = false)
public class SnowflakeDataSourceConfig {

    private static final Logger log = LoggerFactory.getLogger(SnowflakeDataSourceConfig.class);

    @Value("${snowflake.url:}")
    private String url;

    @Value("${snowflake.username:}")
    private String username;

    @Value("${snowflake.password:}")
    private String password;

    @Value("${snowflake.driver-class-name:net.snowflake.client.jdbc.SnowflakeDriver}")
    private String driverClassName;

    /**
     * Returns a {@link DataSource} backed by the Snowflake JDBC driver.
     *
     * <p>Uses {@link DriverManagerDataSource} (no connection pooling) because
     * Snowflake connections are only acquired during an ad-hoc pre-check call
     * and TOTP-appended passwords prevent meaningful connection reuse.</p>
     *
     * <p>If the URL or credentials are not configured the bean is still created
     * but any {@link java.sql.Connection} attempt will fail at runtime — this is
     * intentional so the application starts without Snowflake being required.</p>
     */
    @Bean(name = "snowflakeDataSource")
    public DataSource snowflakeDataSource() {
        if (url == null || url.isBlank()) {
            log.warn("snowflake.url is not configured — Snowflake pre-check will fall back to Exensio HTTP");
        }

        DriverManagerDataSource ds = new DriverManagerDataSource();
        ds.setDriverClassName(driverClassName);
        ds.setUrl(url);
        ds.setUsername(username);
        ds.setPassword(password);
        return ds;
    }
}

