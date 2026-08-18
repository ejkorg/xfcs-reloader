# Design Document: PostgreSQL Internal DB (onsemi-postgresql profile)

## Overview

This design adds a `onsemi-postgresql` Spring profile to the **xfcs-reloader** backend, making PostgreSQL the primary internal application database. The work mirrors the pattern already established in `exensioreload` (`application-onsemi-postgresql.yml` + `RefDbProperties`). No existing profiles or runtime behavior are changed — the feature is purely additive.

All work is delivered on a new Git branch `feature/postgresql-internal-db` branched from the current HEAD of the `xfcs-reloader` repository.

---

## Architecture

The xfcs-reloader backend uses Spring Boot 3.2 with Spring Data JPA, Liquibase for schema management, and HikariCP for connection pooling. The datasource is selected at startup via Spring profiles:

```
Profile: (none)           → H2 in-memory   [development default]
Profile: onsemi-oracle    → Oracle OJDBC11  [existing production]
Profile: onsemi-postgresql → PostgreSQL     [NEW — this feature]
```

The `DataSourceConfig` class (already present) declares the `@Primary` datasource bean from `spring.datasource.*` properties. Profile-specific YAML files override those properties, so no Java configuration changes are needed for the datasource itself.

The new `RefDbProperties` class provides a structured binding for `refdb.*` YAML properties and exposes `buildJdbcUrl()` — the profile YAML then references its values via `${refdb.host}`, `${refdb.port}`, etc., exactly as in exensioreload.

---

## Components and Interfaces

### 1. `pom.xml` — PostgreSQL Driver Dependency

Add to `<dependencies>`:

```xml
<dependency>
    <groupId>org.postgresql</groupId>
    <artifactId>postgresql</artifactId>
    <scope>runtime</scope>
</dependency>
```

No version specified — inherited from `spring-boot-starter-parent` BOM.

---

### 2. `RefDbProperties.java` — New Configuration Class

Location: `backend/src/main/java/com/onsemi/cim/apps/exensio/xfcsreloader/config/RefDbProperties.java`

```java
@Component
@ConfigurationProperties(prefix = "refdb")
public class RefDbProperties {
    private String dbType = "oracle";
    private String host;
    private int port;
    private String database;
    private String sid;
    private String service;
    private String user;
    private String password;
    private Pool pool = new Pool();

    public boolean isPostgres() {
        return dbType != null && dbType.trim().equalsIgnoreCase("postgresql");
    }

    public String buildJdbcUrl() {
        if (isPostgres()) {
            String db = firstNonBlank(database, service, sid);
            return String.format("jdbc:postgresql://%s:%d/%s", host, port, db);
        }
        if (service != null && !service.isBlank())
            return String.format("jdbc:oracle:thin:@//%s:%d/%s", host, port, service);
        if (sid != null && !sid.isBlank())
            return String.format("jdbc:oracle:thin:@%s:%d:%s", host, port, sid);
        return String.format("jdbc:oracle:thin:@%s:%d", host, port);
    }
    // ... getters, setters, Pool inner class
}
```

`PpLogDbProperties` (the existing separate Oracle pp_log bean) is unchanged — it keeps its own `refdb.pplog.*` prefix.

---

### 3. `application-onsemi-postgresql.yml` — New Profile File

Location: `backend/src/main/resources/application-onsemi-postgresql.yml`

Key sections (modeled on exensioreload):

```yaml
spring:
  config:
    activate:
      on-profile: onsemi-postgresql
  datasource:
    url: "jdbc:postgresql://${refdb.host}:${refdb.port}/${refdb.database}"
    username: ${refdb.user}
    password: ${refdb.password}
    driver-class-name: org.postgresql.Driver
    hikari:
      maximum-pool-size: ${refdb.pool.max-size:10}
      minimum-idle: ${refdb.pool.min-idle:2}
      connection-timeout: 30000
      idle-timeout: 600000
      validation-timeout: 5000
      leak-detection-threshold: 30000
  jpa:
    properties:
      hibernate.dialect: org.hibernate.dialect.PostgreSQLDialect
      hibernate.jdbc.time_zone: UTC
  liquibase:
    enabled: true
    change-log: classpath:db/changelog/db.changelog-master.xml

refdb:
  db-type: postgresql
  host: ${XFCS_PG_HOST:localhost}
  port: ${XFCS_PG_PORT:5432}
  database: ${XFCS_PG_DATABASE:xfcs_reloader}
  user: ${XFCS_PG_USER:xfcs}
  password: ${XFCS_PG_PASSWORD:}
  pool:
    max-size: 10
    min-idle: 2
```

Server context path, compression, and mail settings will match `application-onsemi-oracle.yml`.

---

### 4. Liquibase Changelog — CLOB Portability

**Problem**: `db.changelog-5.0-reload-sessions.xml` declares `details` as type `CLOB`. Liquibase maps `CLOB` to `TEXT` on PostgreSQL automatically (via its type mappings) and to `CLOB` on Oracle. This built-in mapping is sufficient — **no changelog modification is needed**.

Verification: Liquibase's `DatabaseDataTypeConverter` resolves `CLOB` → `TEXT` for PostgreSQL. The `preConditions` guards with `onFail="MARK_RAN"` already handle idempotency.

---

### 5. Entity Compatibility

**`ReloadSessionEntity`** has:
- `@Lob @Column(name = "details") private String details;` — On PostgreSQL, Hibernate with `@Lob` on a `String` field maps to `TEXT`. This works cleanly.
- `@JdbcTypeCode(SqlTypes.TIMESTAMP)` on `Instant` fields — This is portable across Oracle and PostgreSQL.

**`ReloadPendingFileEntity`** uses `@Convert(converter = InstantTimestampConverter.class)`. `InstantTimestampConverter` converts `Instant` ↔ `java.sql.Timestamp`, which is portable.

**`ReloadSessionEventEntity`** uses `@JdbcTypeCode(SqlTypes.TIMESTAMP)` — portable.

**`ReloadSessionNotificationEntity`** uses `@Convert(converter = InstantTimestampConverter.class)` — portable.

**Conclusion**: No entity changes are required. All JPA annotations are already portable.

---

## Data Models

No new tables or schema changes. The existing Liquibase changelogs create all required tables. The new profile simply directs Liquibase to run those same changesets against PostgreSQL.

| Table | Notes |
|---|---|
| `xfcs_dearchiver_reload_sessions` | `details` CLOB → TEXT on PG (Liquibase auto-maps) |
| `xfcs_dearchiver_reload_pending_files` | All standard types, no changes |
| `xfcs_dearchiver_reload_session_events` | `id BIGINT autoIncrement` — PG uses SERIAL/IDENTITY, Liquibase handles it |
| `xfcs_dearchiver_reload_session_notifications` | All standard types, no changes |

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: `buildJdbcUrl()` produces a valid typed URL for any valid RefDbProperties input

*For any* `RefDbProperties` instance with a non-blank `host`, a valid `port`, and a non-blank `database` (or fallback `service`/`sid`):
- When `dbType` is `"postgresql"` (any casing), `buildJdbcUrl()` SHALL return a string matching `jdbc:postgresql://<host>:<port>/<db>`
- When `dbType` is anything other than `"postgresql"`, `buildJdbcUrl()` SHALL return a string starting with `jdbc:oracle:thin:`

**Validates: Requirements 2.3, 2.4, 2.5**

---

### Property 2: `isPostgres()` is case-insensitive on `dbType`

*For any* string value of `dbType` that equals `"postgresql"` under case-insensitive comparison, `isPostgres()` SHALL return `true`; for all other non-null values it SHALL return `false`.

This is subsumed by Property 1 (since `buildJdbcUrl()` delegates to `isPostgres()`) but is worth testing independently for clarity.

**Validates: Requirements 2.4**

**Property Reflection**: Property 2 is largely redundant given Property 1 covers it end-to-end. During implementation, a single property test covering `buildJdbcUrl()` across varied inputs (including `dbType` casing variants) is sufficient. Property 2 can be tested as an edge case within the same test.

---

## Error Handling

| Scenario | Behavior |
|---|---|
| `XFCS_PG_PASSWORD` env var not set | Application fails to start with a clear HikariCP connection error |
| PostgreSQL server unreachable | Application fails to start; Spring Boot health endpoint reports `DOWN` |
| Liquibase migration fails on PG | Application fails to start; full Liquibase error stack trace in logs |
| `onsemi-postgresql` profile active with Oracle driver missing | Not possible — pom.xml includes both drivers |
| `onsemi-oracle` profile active after this change | Unchanged behavior — Oracle config files untouched |

---

## Testing Strategy

### Dual Testing Approach

Both unit/example tests and property-based tests are used:
- **Example tests**: Verify specific YAML values, class annotations, file structure, and non-regression of Oracle/H2 profiles
- **Property tests**: Verify `RefDbProperties.buildJdbcUrl()` and `isPostgres()` across generated inputs

### Property-Based Testing

The project already includes `net.jqwik:jqwik` (v1.8.2) in `pom.xml` for property-based testing. Use jqwik for the property test.

**Property test — `RefDbPropertiesTest`**:

```java
// Feature: postgresql-internal-db, Property 1: buildJdbcUrl produces valid typed URL
@Property(tries = 200)
void buildJdbcUrl_returnsPostgresUrl_whenDbTypeIsPostgresCaseInsensitive(
    @ForAll @StringLength(min=1, max=64) String host,
    @ForAll @IntRange(min=1024, max=65535) int port,
    @ForAll @StringLength(min=1, max=32) String database,
    @ForAll @From("postgresDbTypeVariants") String dbType
) {
    RefDbProperties props = new RefDbProperties();
    props.setDbType(dbType);
    props.setHost(host);
    props.setPort(port);
    props.setDatabase(database);

    assertThat(props.isPostgres()).isTrue();
    assertThat(props.buildJdbcUrl())
        .startsWith("jdbc:postgresql://")
        .contains(host)
        .contains(String.valueOf(port))
        .contains(database);
}

@Provide
Arbitrary<String> postgresDbTypeVariants() {
    return Arbitraries.of("postgresql", "PostgreSQL", "POSTGRESQL", "PostgreSql");
}
```

Minimum 200 iterations (default jqwik tries).

### Unit / Example Tests

The Java/Maven environment is not available in this workspace, so tests should be written to be run manually by the developer. Key example tests:

1. `pom.xml` contains `org.postgresql:postgresql` dependency
2. `application-onsemi-postgresql.yml` has `on-profile: onsemi-postgresql`, PostgreSQL dialect, Liquibase enabled
3. `RefDbProperties` fields and annotations match specification
4. Oracle profile files (`application-onsemi-oracle.yml`, `application.yml`) are unchanged
5. `buildJdbcUrl()` with `dbType=null` defaults to Oracle URL (fallback behavior)
