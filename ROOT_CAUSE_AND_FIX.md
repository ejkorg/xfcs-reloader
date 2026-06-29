# Root Cause: Liquibase Targeting Snowflake Instead of Oracle

## The Problem

Logs showed:
```
Creating database history table with name: ANALYTICSPRD.MFG.DATABASECHANGELOG
SQL access control error: Insufficient privileges to operate on schema 'MFG'
```

**Why it happened:** The primary Spring datasource was being set to Snowflake, and Liquibase was running migrations against the read-only Snowflake user.

## Root Cause Analysis

When Spring Boot starts with a Snowflake JDBC driver on the classpath, it can:
1. Auto-detect multiple candidate datasources (H2, Oracle, Snowflake)
2. Create an ambiguous bean configuration where Snowflake becomes primary
3. Liquibase uses the primary datasource and crashes trying to CREATE TABLE in read-only Snowflake

**The systemd service was missing `SPRING_PROFILES_ACTIVE=onsemi-oracle`**, so:
- Default profile loaded (H2 datasource from `application.yml`)
- But Snowflake JDBC was on the classpath and got picked up
- Spring's datasource auto-configuration got confused
- Liquibase tried Snowflake and failed

## Solution Implemented

### 1. ✅ Explicit Primary DataSource Bean
Created `DataSourceConfig.java` with `@Primary` annotation:
```java
@Bean
@Primary
@ConfigurationProperties(prefix = "spring.datasource")
public DataSource primaryDataSource() {
    return DataSourceBuilder.create().build();
}
```

**Why:** Forces Spring to use only the configured datasource, preventing auto-detection confusion. The `@ConfigurationProperties` binding means:
- Default profile → uses H2 from `application.yml`
- `onsemi-oracle` profile → uses Oracle from `application-onsemi-oracle.yml`

### 2. ✅ Secondary Snowflake DataSource
`SnowflakeDataSourceConfig.java` bean is `@ConditionalOnProperty` (no `@Primary`):
```java
@Bean(name = "snowflakeDataSource")
public DataSource snowflakeDataSource() { ... }
```

**Why:** Completely separate from primary datasource. Liquibase never sees it.

### 3. ✅ Liquibase Disabled by Default
`application.yml` has hardcoded: `enabled: false`
`application-onsemi-oracle.yml` has explicit: `enabled: true`

**Why:** Two-stage control:
- Stage 1: Profile determines which datasource is primary (Oracle or H2)
- Stage 2: Liquibase only enabled for Oracle profile

### 4. ✅ Systemd Service Configuration
Must include:
```ini
Environment="SPRING_PROFILES_ACTIVE=onsemi-oracle"
```

**Why:** Activates the `onsemi-oracle` profile, which loads Oracle datasource config and enables Liquibase.

## Critical Requirements for Deployment

### What MUST Be Set
```ini
Environment="SPRING_PROFILES_ACTIVE=onsemi-oracle"
Environment="SNOW_URL=jdbc:snowflake://..."
Environment="SNOW_USER=MFG_PRD_RPT_EXENSIO_USER"
Environment="SNOW_PASS=<TOTP password>"
```

### What MUST NOT Be Set
- `XFCS_DB_URL` — Must remain unset; Oracle URL comes from profile
- `XFCS_DB_USERNAME` — Must remain unset
- `XFCS_DB_PASSWORD` — Must remain unset

If any of these are set, they will override the profile's Oracle datasource with whatever URL they point to.

### ExecStart Command
```ini
ExecStart=/apps/exensio/jdk-21.0.8+9/bin/java \
  -jar /export/home/dpower/jag/xfcs-reloader/xfcs-reloader-backend-1.0.0-SNAPSHOT.jar \
  --logging.file.name=/export/home/dpower/logs/xfcs-reloader.log
```

**Note:** Do NOT use `-cp /export/home/dpower/jag/xfcs-reloader/lib/snowflake-jdbc-3.27.1.jar` anymore (Snowflake is in the fat JAR via `<requiresUnpack>`).

## How It Works After Fix

```
systemd starts → 
  SPRING_PROFILES_ACTIVE=onsemi-oracle set ↓
Spring Boot loads profiles in order:
  1. application.yml (Liquibase: disabled, DS: H2 default)
  2. application-onsemi-oracle.yml (Liquibase: enabled, DS: Oracle)
Profile #2 overrides #1 ↓
Primary datasource: Oracle ✅
SnowflakeDataSourceConfig condition checked:
  SNOW_URL is set → Create secondary bean ✅
Application initialization:
  1. Primary datasource → Oracle
  2. Liquibase → Runs against Oracle ✅
  3. Secondary Snowflake bean → Not used by Liquibase
  4. Pre-check queries → Use secondary Snowflake bean ✅
App starts successfully ✅
```

## Verification Steps

1. **Before restarting**, edit systemd service and verify:
   ```bash
   grep SPRING_PROFILES_ACTIVE /etc/systemd/system/xfcs-reloader.service
   # Should output: Environment="SPRING_PROFILES_ACTIVE=onsemi-oracle"
   
   grep XFCS_DB_URL /etc/systemd/system/xfcs-reloader.service
   # Should output nothing (unset)
   ```

2. **Rebuild and deploy**:
   ```bash
   cd backend && mvn clean package -DskipTests
   cp target/xfcs-reloader-backend-1.0.0-SNAPSHOT.jar /export/home/dpower/jag/xfcs-reloader/
   ```

3. **Restart service**:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl restart xfcs-reloader
   ```

4. **Verify logs** (should see):
   ```
   The following 1 profile is active: "onsemi-oracle"
   Creating database history table...
   Liquibase...
   Creating secondary Snowflake datasource for pre-check queries
   Tomcat started on port 8005
   ```

5. **Health check**:
   ```bash
   curl http://usaz15ls088:8005/xfcs-reloader/actuator/health
   # Expected: {"status":"UP"}
   ```

## Files Changed

1. `backend/pom.xml` — Snowflake JDBC: removed `<scope>provided</scope>`
2. `backend/src/main/resources/application.yml` — Liquibase: hardcoded `enabled: false`
3. `backend/src/main/java/.../config/DataSourceConfig.java` — **NEW**: Primary datasource bean
4. `backend/src/main/java/.../config/SnowflakeDataSourceConfig.java` — Added log message
5. `/etc/systemd/system/xfcs-reloader.service` — **Must add**: `SPRING_PROFILES_ACTIVE=onsemi-oracle`

