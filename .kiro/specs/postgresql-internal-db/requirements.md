# Requirements Document

## Introduction

This feature adds a new Spring profile `onsemi-postgresql` to the **xfcs-reloader** backend, making PostgreSQL the primary internal application database — identical in pattern to what was done in `exensioreload`. The current production profile uses Oracle (`onsemi-oracle`) with H2 as the local dev default. After this change, operators can activate `onsemi-postgresql` to persist all xfcs-reloader state (reload sessions, pending files, session events, notifications) in PostgreSQL, while the Oracle and H2 profiles remain fully functional.

The implementation follows the exensioreload reference closely: a `RefDbProperties`-style configuration class, a new `application-onsemi-postgresql.yml` profile file, the PostgreSQL JDBC driver dependency in `pom.xml`, and Liquibase enabled in the new profile.

---

## Glossary

- **Primary DB**: The Spring `spring.datasource.*` datasource used by JPA/Hibernate for all application entities.
- **RefDbProperties**: A `@ConfigurationProperties` bean holding host, port, database name, credentials, and pool settings for the primary DB, with a `buildJdbcUrl()` helper — mirroring the pattern from exensioreload.
- **onsemi-postgresql profile**: The Spring profile `onsemi-postgresql` that activates PostgreSQL as the primary DB.
- **onsemi-oracle profile**: The existing Spring profile that activates Oracle as the primary DB (must remain untouched).
- **H2 profile**: The default local-dev in-memory database (no named profile; used when no profile is active).
- **Liquibase**: Database migration tool already present in xfcs-reloader; currently enabled only in `onsemi-oracle`.
- **HikariCP**: Connection pool used by Spring Boot's datasource auto-configuration.
- **PpLogDbProperties**: Existing bean for the separate read-only Oracle pp_log connection (unchanged by this feature).
- **DataSourceConfig**: Existing class that explicitly declares the `@Primary` datasource bean.

---

## Requirements

### Requirement 1: PostgreSQL JDBC Driver Dependency

**User Story:** As a developer, I want the PostgreSQL JDBC driver available at runtime, so that the application can connect to a PostgreSQL database when the `onsemi-postgresql` profile is active.

#### Acceptance Criteria

1. THE `pom.xml` SHALL declare a dependency on `org.postgresql:postgresql` with `runtime` scope, matching the pattern used in exensioreload.
2. WHEN the project is compiled, THE build SHALL succeed without errors related to the PostgreSQL driver.

---

### Requirement 2: RefDbProperties Configuration Class

**User Story:** As a developer, I want a `RefDbProperties` configuration class, so that PostgreSQL (and Oracle) connection parameters are defined in a single, structured place and can be referenced by the datasource configuration.

#### Acceptance Criteria

1. THE `RefDbProperties` class SHALL be annotated with `@Component` and `@ConfigurationProperties(prefix = "refdb")`.
2. THE `RefDbProperties` class SHALL expose fields: `dbType` (default `"oracle"`), `host`, `port`, `database`, `sid`, `service`, `user`, `password`, `pool` (with `maxSize` and `minIdle`).
3. THE `RefDbProperties` class SHALL include a `buildJdbcUrl()` method that returns a PostgreSQL JDBC URL (`jdbc:postgresql://host:port/database`) when `dbType` equals `"postgresql"` (case-insensitive), and an Oracle JDBC URL otherwise.
4. THE `RefDbProperties` class SHALL include an `isPostgres()` method that returns `true` when `dbType` equals `"postgresql"` (case-insensitive).
5. IF `database` is blank or null AND `dbType` is `"postgresql"`, THEN THE `buildJdbcUrl()` method SHALL fall back to `service` then `sid` as the database name, matching exensioreload behavior.

---

### Requirement 3: onsemi-postgresql Spring Profile

**User Story:** As an operator, I want to activate a dedicated `onsemi-postgresql` Spring profile, so that the application connects to a PostgreSQL instance without modifying any other profile.

#### Acceptance Criteria

1. THE `application-onsemi-postgresql.yml` file SHALL declare `spring.config.activate.on-profile: onsemi-postgresql`.
2. WHEN the `onsemi-postgresql` profile is active, THE `spring.datasource` SHALL be configured with `driver-class-name: org.postgresql.Driver` and a JDBC URL derived from `refdb.*` properties.
3. WHEN the `onsemi-postgresql` profile is active, THE `spring.jpa.properties.hibernate.dialect` SHALL be set to `org.hibernate.dialect.PostgreSQLDialect`.
4. WHEN the `onsemi-postgresql` profile is active, THE `spring.liquibase.enabled` SHALL be set to `true` and SHALL reference the existing master changelog `classpath:db/changelog/db.changelog-master.xml`.
5. THE `application-onsemi-postgresql.yml` file SHALL include `refdb.*` properties (host, port, database, user, password, pool settings) populated with appropriate placeholder values (or environment variable references) for the target PostgreSQL instance.
6. THE `application-onsemi-postgresql.yml` file SHALL include HikariCP pool settings (`maximum-pool-size`, `minimum-idle`, `connection-timeout`, `idle-timeout`, `validation-timeout`, `leak-detection-threshold`) matching the exensioreload pattern.
7. THE `application-onsemi-postgresql.yml` SHALL set the server context path, compression, and mail settings consistent with the existing `onsemi-oracle` profile.

---

### Requirement 4: Liquibase Changelog Compatibility

**User Story:** As a developer, I want the existing Liquibase changelogs to run cleanly against PostgreSQL, so that all application tables are created correctly on first startup with the `onsemi-postgresql` profile.

#### Acceptance Criteria

1. WHEN the `onsemi-postgresql` profile is active, THE Liquibase SHALL execute all changesets in `db.changelog-master.xml` against PostgreSQL without errors.
2. IF any existing changeset uses Oracle-specific DDL (e.g., `CLOB` type, Oracle sequences, Oracle-specific functions), THEN THE changeset SHALL be updated to use Liquibase portable types (e.g., `CLOB` → handled by Liquibase type mapping, or replaced with `TEXT` using `dbms` conditions) so that it runs on both Oracle and PostgreSQL.
3. THE `details` column in `xfcs_dearchiver_reload_sessions` (currently declared as `CLOB`) SHALL be compatible with PostgreSQL; Liquibase SHALL map or replace it to a type that PostgreSQL supports (e.g., `TEXT` or `CLOB` via Liquibase's built-in type mapping).

---

### Requirement 5: Entity and Repository Compatibility

**User Story:** As a developer, I want the existing JPA entities and Spring Data repositories to work with PostgreSQL, so that no application logic changes are required when switching profiles.

#### Acceptance Criteria

1. THE existing JPA entities (`ReloadSessionEntity`, `ReloadPendingFileEntity`, `ReloadSessionEventEntity`, `ReloadSessionNotificationEntity`) SHALL function without modification against PostgreSQL.
2. IF any entity uses an `@Lob` annotation or `@JdbcTypeCode(SqlTypes.CLOB)` in a way that is Oracle-specific, THEN THE entity SHALL be updated to use a portable annotation compatible with both Oracle and PostgreSQL.
3. THE existing Spring Data repositories SHALL require no changes to operate against PostgreSQL.

---

### Requirement 6: Existing Profiles Remain Unaffected

**User Story:** As an operator, I want the existing `onsemi-oracle` and H2 profiles to continue working unchanged, so that migrating to PostgreSQL is strictly additive.

#### Acceptance Criteria

1. WHEN the `onsemi-oracle` profile is active, THE application SHALL connect to Oracle exactly as it does before this feature is implemented.
2. WHEN no profile is active (H2 default), THE application SHALL start with the in-memory H2 database exactly as it does before this feature is implemented.
3. THE changes introduced by this feature SHALL NOT modify `application-onsemi-oracle.yml`, `application.yml`, or any existing Java class in a way that alters the behavior of the `onsemi-oracle` or H2 profiles.

---

### Requirement 7: New Git Branch

**User Story:** As a developer, I want all changes delivered on a dedicated Git branch, so that the feature can be reviewed and merged independently.

#### Acceptance Criteria

1. THE implementation SHALL be committed to a new branch named `feature/postgresql-internal-db` (or equivalent) in the `xfcs-reloader` repository.
2. THE new branch SHALL be created from the current `main` (or `master`) branch HEAD.
3. THE existing branch SHALL remain unchanged until the feature branch is explicitly merged.
