package com.onsemi.cim.apps.exensio.xfcsreloader.config;

import net.jqwik.api.*;

import static org.assertj.core.api.Assertions.*;

/**
 * Property-based tests for RefDbProperties.
 * Feature: postgresql-internal-db, Property 1: buildJdbcUrl produces valid typed URL
 * Validates: Requirements 2.3, 2.4, 2.5
 */
public class RefDbPropertiesTest {

    /**
     * Property: buildJdbcUrl produces valid typed URL for PostgreSQL.
     * For any valid PostgreSQL configuration, buildJdbcUrl() should return a valid PostgreSQL JDBC URL.
     */
    @Property(tries = 200)
    void buildJdbcUrl_returnsPostgresUrl_whenDbTypeIsPostgresCaseInsensitive(
        @ForAll @StringLength(min = 1, max = 64) String host,
        @ForAll @IntRange(min = 1024, max = 65535) int port,
        @ForAll @StringLength(min = 1, max = 32) String database,
        @ForAll("postgresDbTypeVariants") String dbType
    ) {
        RefDbProperties props = new RefDbProperties();
        props.setDbType(dbType);
        props.setHost(host);
        props.setPort(port);
        props.setDatabase(database);

        // Assert that isPostgres() recognizes it as PostgreSQL
        assertThat(props.isPostgres()).isTrue();

        // Assert that buildJdbcUrl() returns a valid PostgreSQL URL
        String url = props.buildJdbcUrl();
        assertThat(url)
            .startsWith("jdbc:postgresql://")
            .contains(host)
            .contains(String.valueOf(port))
            .contains(database);
    }

    /**
     * Property: buildJdbcUrl produces valid Oracle URL for non-PostgreSQL dbType.
     * For any Oracle configuration, buildJdbcUrl() should return a valid Oracle JDBC URL.
     */
    @Property(tries = 200)
    void buildJdbcUrl_returnsOracleUrl_whenDbTypeIsNotPostgres(
        @ForAll @StringLength(min = 1, max = 64) String host,
        @ForAll @IntRange(min = 1024, max = 65535) int port,
        @ForAll @StringLength(min = 1, max = 32) String service,
        @ForAll("oracleDbTypeVariants") String dbType
    ) {
        RefDbProperties props = new RefDbProperties();
        props.setDbType(dbType);
        props.setHost(host);
        props.setPort(port);
        props.setService(service);

        // Assert that isPostgres() returns false
        assertThat(props.isPostgres()).isFalse();

        // Assert that buildJdbcUrl() returns a valid Oracle URL
        String url = props.buildJdbcUrl();
        assertThat(url)
            .startsWith("jdbc:oracle:thin:@");
    }

    /**
     * Property: buildJdbcUrl falls back to service when database is blank (PostgreSQL).
     * For PostgreSQL config with blank database, fallback to service should be used.
     */
    @Property(tries = 100)
    void buildJdbcUrl_fallsBackToService_whenDatabaseIsBlank(
        @ForAll @StringLength(min = 1, max = 64) String host,
        @ForAll @IntRange(min = 1024, max = 65535) int port,
        @ForAll @StringLength(min = 1, max = 32) String service
    ) {
        RefDbProperties props = new RefDbProperties();
        props.setDbType("postgresql");
        props.setHost(host);
        props.setPort(port);
        props.setDatabase(""); // blank database
        props.setService(service);

        String url = props.buildJdbcUrl();
        assertThat(url)
            .startsWith("jdbc:postgresql://")
            .contains(service);
    }

    /**
     * Property: buildJdbcUrl falls back to sid when both database and service are blank (PostgreSQL).
     * For PostgreSQL config with blank database and service, fallback to sid should be used.
     */
    @Property(tries = 100)
    void buildJdbcUrl_fallsBackToSid_whenDatabaseAndServiceAreBlank(
        @ForAll @StringLength(min = 1, max = 64) String host,
        @ForAll @IntRange(min = 1024, max = 65535) int port,
        @ForAll @StringLength(min = 1, max = 32) String sid
    ) {
        RefDbProperties props = new RefDbProperties();
        props.setDbType("postgresql");
        props.setHost(host);
        props.setPort(port);
        props.setDatabase(""); // blank database
        props.setService(""); // blank service
        props.setSid(sid);

        String url = props.buildJdbcUrl();
        assertThat(url)
            .startsWith("jdbc:postgresql://")
            .contains(sid);
    }

    /**
     * Property: isPostgres() is case-insensitive.
     * For any casing variant of "postgresql", isPostgres() should return true.
     */
    @Property(tries = 50)
    void isPostgres_isCaseInsensitive(
        @ForAll("postgresDbTypeVariants") String dbType
    ) {
        RefDbProperties props = new RefDbProperties();
        props.setDbType(dbType);

        assertThat(props.isPostgres()).isTrue();
    }

    /**
     * Property: isPostgres() returns false for null or non-PostgreSQL dbType.
     * For null or non-PostgreSQL dbType values, isPostgres() should return false.
     */
    @Property(tries = 50)
    void isPostgres_returnsFalse_forNullOrNonPostgres(
        @ForAll("oracleDbTypeVariants") String dbType
    ) {
        RefDbProperties props = new RefDbProperties();
        props.setDbType(dbType);

        assertThat(props.isPostgres()).isFalse();
    }

    /**
     * Property: Pool inner class has correct defaults.
     * For a new Pool instance, maxSize should be 5 and minIdle should be 1.
     */
    @Property
    void pool_hasCorrectDefaults() {
        RefDbProperties.Pool pool = new RefDbProperties.Pool();

        assertThat(pool.getMaxSize()).isEqualTo(5);
        assertThat(pool.getMinIdle()).isEqualTo(1);
    }

    // ============ Providers ============

    @Provide
    Arbitrary<String> postgresDbTypeVariants() {
        return Arbitraries.of("postgresql", "PostgreSQL", "POSTGRESQL", "PostgreSql", "postgreSql");
    }

    @Provide
    Arbitrary<String> oracleDbTypeVariants() {
        return Arbitraries.of("oracle", "ORACLE", "Oracle", null, "", "mariadb", "mysql");
    }
}
