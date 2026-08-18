# Implementation Plan: PostgreSQL Internal DB (onsemi-postgresql profile)

## Overview

Add PostgreSQL as a supported primary database for xfcs-reloader, mirroring the pattern from exensioreload. All changes are additive — existing Oracle and H2 profiles remain untouched. Delivered on branch `feature/postgresql-internal-db`.

## Tasks

- [x] 1. Create the feature branch
  - Run `git checkout -b feature/postgresql-internal-db` in the `xfcs-reloader` repository
  - Verify the branch is based on current `main`/`master` HEAD
  - _Requirements: 7.1, 7.2_

- [x] 2. Add PostgreSQL JDBC driver to pom.xml
  - [x] 2.1 Add `org.postgresql:postgresql` with `runtime` scope to `backend/pom.xml`
    - Do NOT specify a version — let `spring-boot-starter-parent` BOM manage it
    - Place it near the existing `com.h2database` dependency for grouping clarity
    - _Requirements: 1.1_

  - [ ]* 2.2 Verify pom.xml dependency presence (example test)
    - Confirm `org.postgresql:postgresql` appears in `pom.xml` with `runtime` scope
    - _Requirements: 1.1_

- [x] 3. Create RefDbProperties configuration class
  - [x] 3.1 Create `RefDbProperties.java` in `backend/src/main/java/com/onsemi/cim/apps/exensio/xfcsreloader/config/`
    - Annotate with `@Component` and `@ConfigurationProperties(prefix = "refdb")`
    - Fields: `dbType` (default `"oracle"`), `host`, `port` (int), `database`, `sid`, `service`, `user`, `password`
    - Inner class `Pool` with `maxSize` (default 5) and `minIdle` (default 1)
    - `isPostgres()`: returns `dbType != null && dbType.trim().equalsIgnoreCase("postgresql")`
    - `buildJdbcUrl()`: when `isPostgres()`, return `jdbc:postgresql://host:port/database` (falling back to `service` then `sid` if `database` is blank); otherwise return Oracle JDBC URL using service or SID style
    - Full getters and setters for all fields
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x]* 3.2 Write property-based test for `RefDbProperties.buildJdbcUrl()` and `isPostgres()`
    - Create `RefDbPropertiesTest.java` in `backend/src/test/java/com/onsemi/cim/apps/exensio/xfcsreloader/config/`
    - Use jqwik (`@Property`, `@ForAll`, `@Provide`) — already in pom.xml
    - **Property 1: buildJdbcUrl produces valid typed URL**
    - Generate: arbitrary non-blank host string, port in 1024–65535, non-blank database, `dbType` from `{"postgresql", "PostgreSQL", "POSTGRESQL", "PostgreSql"}`
    - Assert: `isPostgres()` is `true`, URL starts with `jdbc:postgresql://`, contains host/port/database
    - Generate: `dbType` from `{"oracle", "ORACLE", null, ""}` with non-blank host/service
    - Assert: URL starts with `jdbc:oracle:thin:`
    - Edge case: `database` blank, `service` non-blank → URL uses `service` as db name
    - Minimum 200 tries (`@Property(tries = 200)`)
    - Tag: `// Feature: postgresql-internal-db, Property 1: buildJdbcUrl produces valid typed URL`
    - **Validates: Requirements 2.3, 2.4, 2.5**
    - _Requirements: 2.3, 2.4, 2.5_

- [x] 4. Create the onsemi-postgresql Spring profile
  - [x] 4.1 Create `application-onsemi-postgresql.yml` in `backend/src/main/resources/`
    - `spring.config.activate.on-profile: onsemi-postgresql`
    - `spring.datasource`: url, username, password, driver-class-name, HikariCP pool settings (all referencing `${refdb.*}`)
    - `spring.jpa.properties.hibernate.dialect: org.hibernate.dialect.PostgreSQLDialect`
    - `spring.jpa.properties.hibernate.jdbc.time_zone: UTC`
    - `spring.liquibase.enabled: true`, `change-log: classpath:db/changelog/db.changelog-master.xml`
    - `spring.mail` settings (matching `onsemi-oracle` profile)
    - `server` block: port 8005, context-path `/xfcs-reloader`, compression enabled
    - `refdb` block: `db-type: postgresql`, host/port/database/user/password all as env var references (`${XFCS_PG_HOST:localhost}`, `${XFCS_PG_PORT:5432}`, `${XFCS_PG_DATABASE:xfcs_reloader}`, `${XFCS_PG_USER:xfcs}`, `${XFCS_PG_PASSWORD:}`)
    - `refdb.pool`: `max-size: 10`, `min-idle: 2`
    - `security.allowed-origins` matching `onsemi-oracle` profile
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

  - [ ]* 4.2 Verify profile YAML content (example tests)
    - Confirm `on-profile: onsemi-postgresql` is present
    - Confirm `driver-class-name: org.postgresql.Driver`
    - Confirm `hibernate.dialect: org.hibernate.dialect.PostgreSQLDialect`
    - Confirm `spring.liquibase.enabled: true`
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 5. Checkpoint — review all new files
  - Verify `RefDbProperties.java`, `application-onsemi-postgresql.yml`, and pom.xml change are correct
  - Confirm `application.yml` and `application-onsemi-oracle.yml` are unmodified
  - Ensure all tests pass, ask the user if questions arise

- [x] 6. Verify non-regression of existing profiles
  - [x] 6.1 Confirm `application.yml` (H2 default) is unchanged
    - Read the file and verify no new properties or modifications were introduced
    - _Requirements: 6.2, 6.3_

  - [x] 6.2 Confirm `application-onsemi-oracle.yml` is unchanged
    - Read the file and verify no new properties or modifications were introduced
    - _Requirements: 6.1, 6.3_

  - [x] 6.3 Confirm existing Java config classes (`DataSourceConfig`, `PpLogDbProperties`) are unmodified
    - Verify that `DataSourceConfig` still works as-is (it reads `spring.datasource.*` which is set per-profile)
    - Note: `PpLogDbProperties` uses prefix `refdb.pplog` — confirm it is not broken by the new `RefDbProperties` using prefix `refdb`
    - _Requirements: 6.3_

- [x] 7. Final checkpoint — ensure all files are consistent
  - Ensure all tests pass, ask the user if questions arise
  - Confirm the branch `feature/postgresql-internal-db` has all changes committed

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- `RefDbProperties` must NOT conflict with the existing `PpLogDbProperties` — `PpLogDbProperties` binds to `refdb.pplog.*` and `RefDbProperties` binds to `refdb.*`; Spring's `@ConfigurationProperties` handles this hierarchy correctly
- The `DataSourceConfig` class needs no changes — it already reads `spring.datasource.*`, which the new profile YAML populates
- Liquibase `CLOB` type is automatically mapped to `TEXT` by Liquibase on PostgreSQL — no changeset modifications are required
- The `InstantTimestampConverter` and `@JdbcTypeCode(SqlTypes.TIMESTAMP)` annotations in entities are already PostgreSQL-compatible
- jqwik is already in pom.xml at version 1.8.2 — no new test dependency needed
