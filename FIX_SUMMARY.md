# Snowflake Liquibase Fix — Implementation Summary

## Problem Statement
App crashed on startup with:
```
liquibase.exception.DatabaseException: SQL access control error:
Insufficient privileges to operate on schema 'MFG'. 
Your primary role ANALYTICSPRD_MFG_ANALYST must have CREATE TABLE granted on SCHEMA ANALYTICSPRD.MFG
```

**Root cause**: Liquibase was executing `CREATE TABLE DATABASECHANGELOG` against the read-only Snowflake datasource instead of Oracle.

## Changes Made

### 1. ✅ Fixed pom.xml (Snowflake JDBC Packaging)
**Before:**
```xml
<dependency>
  <groupId>net.snowflake</groupId>
  <artifactId>snowflake-jdbc</artifactId>
  <version>3.27.1</version>
  <scope>provided</scope>  <!-- ❌ Excludes from fat JAR -->
</dependency>
```

**After:**
```xml
<dependency>
  <groupId>net.snowflake</groupId>
  <artifactId>snowflake-jdbc</artifactId>
  <version>3.27.1</version>
  <!-- ✅ Includes in fat JAR (default compile scope) -->
</dependency>
```

**Why**: The `<requiresUnpack>` configuration in spring-boot-maven-plugin extracts the JAR from the fat JAR to disk at startup. This requires it to be packaged first.

### 2. ✅ Hardcoded Liquibase Disabled in application.yml
**Before:**
```yaml
liquibase:
  enabled: ${LIQUIBASE_ENABLED:false}
```

**After:**
```yaml
liquibase:
  enabled: false
```

**Why**: Ensures Liquibase is disabled by default with no way to accidentally enable it via environment variable. Only the `onsemi-oracle` profile can enable it.

### 3. ✅ Verified application-onsemi-oracle.yml
Already correctly configured:
```yaml
spring:
  datasource:
    url: jdbc:oracle:thin:@//exnqa-db.onsemi.com:1740/EXNQA.onsemi.com
    # Oracle credentials (hardcoded for QA)
  liquibase:
    enabled: true  # ✅ Explicitly enabled only for Oracle profile
    change-log: classpath:db/changelog/db.changelog-master.xml
```

### 4. ✅ Verified SnowflakeDataSourceConfig.java
Already correctly configured:
```java
@Configuration
@ConditionalOnProperty(name = "snowflake.url", matchIfMissing = false)
public class SnowflakeDataSourceConfig {
  @Bean(name = "snowflakeDataSource")  // ✅ Named bean, no @Primary
  public DataSource snowflakeDataSource() { ... }
}
```

**Why**: 
- Snowflake bean only created when `snowflake.url` environment variable is set
- Named "snowflakeDataSource", so it's NOT Spring's primary datasource
- Liquibase uses the primary datasource only (Oracle)

## Configuration Rules

| Setting | Value | Reason |
|---------|-------|--------|
| `spring.profiles.active` | `onsemi-oracle` | Activates Oracle datasource + Liquibase |
| `SNOW_URL` | `jdbc:snowflake://onsemi.west-us-2.azure.snowflakecomputing.com/?db=ANALYTICSPRD&schema=MFG&warehouse=MFG_PRD_RPT_WH&user=MFG_PRD_RPT_EXENSIO_USER` | Enables secondary Snowflake datasource for pre-check queries only |
| `SNOW_PASS` | `<TOTP token here>` | Snowflake read-only user password (with TOTP appended) |
| `XFCS_DB_URL` | **NOT SET** | Must remain unset; Oracle URL comes from onsemi-oracle profile |
| `XFCS_DB_USERNAME` | **NOT SET** | Must remain unset; comes from onsemi-oracle profile |
| `XFCS_DB_PASSWORD` | **NOT SET** | Must remain unset; comes from onsemi-oracle profile |

## How It Works Now

```
Application Startup
├─ Spring profile activated: onsemi-oracle
├─ Primary DataSource: Oracle (from onsemi-oracle.yml)
├─ Liquibase enabled: YES (from onsemi-oracle.yml)
├─ Liquibase target: Oracle only ✅
├─ SNOW_URL environment variable: set
├─ SnowflakeDataSourceConfig condition: matched
├─ Secondary DataSource: Snowflake (from config)
│  └─ Bean name: snowflakeDataSource (not @Primary)
│  └─ Used by: ExensioPreCheckService only
│  └─ Liquibase access: NO ✅
└─ Application ready
```

## Deployment Instructions

1. **Rebuild**: `cd backend && mvn clean package -DskipTests`
2. **Copy JAR**: `scp target/xfcs-reloader-backend-1.0.0-SNAPSHOT.jar dpower@usaz15ls088:/opt/xfcs-reloader/`
3. **Update systemd service** (`/etc/systemd/system/xfcs-reloader.service`):
   ```ini
   Environment="SPRING_PROFILES_ACTIVE=onsemi-oracle"
   Environment="SNOW_URL=jdbc:snowflake://onsemi.west-us-2.azure.snowflakecomputing.com/?db=ANALYTICSPRD&schema=MFG&warehouse=MFG_PRD_RPT_WH&user=MFG_PRD_RPT_EXENSIO_USER"
   Environment="SNOW_PASS=<current TOTP password>"
   ```
4. **Restart**: `sudo systemctl daemon-reload && sudo systemctl restart xfcs-reloader`
5. **Verify**: `curl http://usaz15ls088:8005/xfcs-reloader/actuator/health`

## Expected Behavior After Deployment

✅ App starts without errors
✅ Liquibase migrates Oracle schema
✅ Snowflake pre-check queries execute (SELECT-only)
✅ No Liquibase CREATE attempts against Snowflake
✅ Health check returns `{"status":"UP"}`

