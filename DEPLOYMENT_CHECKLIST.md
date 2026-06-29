# Deployment Checklist: Snowflake Pre-Check Fix

## Issue Fixed
Liquibase was trying to create tables in read-only Snowflake datasource instead of Oracle.

## Root Cause
- Primary datasource was being set to Snowflake (via environment variables)
- Liquibase ran against primary datasource
- Read-only Snowflake user lacks CREATE TABLE privileges
- App crashed on startup

## Solution Implemented

### Backend Changes
1. **pom.xml**: 
   - Removed `<scope>provided</scope>` from Snowflake JDBC
   - Kept `<requiresUnpack>` in spring-boot-maven-plugin
   - Result: JAR packaged in fat JAR, extracted to disk at startup (avoids nested ZIP corruption)

2. **application.yml**:
   - Liquibase disabled by default: `enabled: false` (hardcoded, not env var)
   - Snowflake URL blank by default: `snowflake.url: ${SNOW_URL:}` (empty string)
   - SnowflakeDataSourceConfig only creates bean when `snowflake.url` is set

3. **application-onsemi-oracle.yml**:
   - Liquibase explicitly enabled: `enabled: true`
   - Oracle datasource configured (hardcoded credentials for QA)
   - Only used when profile is active

4. **SnowflakeDataSourceConfig.java**:
   - `@ConditionalOnProperty(name = "snowflake.url", matchIfMissing = false)`
   - Creates secondary datasource bean named "snowflakeDataSource"
   - Only activated when `snowflake.url` environment variable is set

## Deployment Steps

### 1. Rebuild JAR
```bash
cd backend/
mvn clean package -DskipTests
# Output: target/xfcs-reloader-backend-1.0.0-SNAPSHOT.jar
```

### 2. Copy JAR to Server
```bash
scp target/xfcs-reloader-backend-1.0.0-SNAPSHOT.jar dpower@usaz15ls088:/opt/xfcs-reloader/
```

### 3. Update systemd Service
Edit `/etc/systemd/system/xfcs-reloader.service`:

**REQUIRED environment variables:**
```ini
[Service]
Environment="SPRING_PROFILES_ACTIVE=onsemi-oracle"
Environment="SNOW_URL=jdbc:snowflake://onsemi.west-us-2.azure.snowflakecomputing.com/?db=ANALYTICSPRD&schema=MFG&warehouse=MFG_PRD_RPT_WH&user=MFG_PRD_RPT_EXENSIO_USER"
Environment="SNOW_PASS=<TOTP-appended password>"
```

**DO NOT set:**
- `XFCS_DB_URL` (leave unset to use Oracle from onsemi-oracle profile)
- `XFCS_DB_USERNAME` (leave unset)
- `XFCS_DB_PASSWORD` (leave unset)

**Verify the service has:**
```ini
ExecStart=/usr/bin/java -jar /opt/xfcs-reloader/xfcs-reloader-backend-1.0.0-SNAPSHOT.jar
```

### 4. Reload and Restart Service
```bash
sudo systemctl daemon-reload
sudo systemctl restart xfcs-reloader
sudo journalctl -u xfcs-reloader -f
```

## Verification

### Expected Startup Logs
```
[main] Spring configuration: onsemi-oracle profile active
[main] HikariCP/Spring configuring primary datasource (Oracle)
[main] SnowflakeDataSourceConfig: Creating snowflakeDataSource bean
[main] Liquibase: liquibase initialized
[main] Tomcat started on port 8005
```

### NOT Expected
- ❌ "Set default schema name to MFG" (indicates Snowflake became primary)
- ❌ "Creating database history table in ANALYTICSPRD.MFG.DATABASECHANGELOG"
- ❌ "SQL access control error" or "Insufficient privileges"

### Health Check
```bash
curl http://usaz15ls088:8005/xfcs-reloader/actuator/health
# Expected: {"status":"UP"}
```

## Profile Behavior

| Scenario | Profile | Primary DS | Liquibase | Snowflake Bean |
|----------|---------|------------|-----------|---|
| Default (dev) | None | H2 (memory) | Disabled | Not created |
| Oracle env | `onsemi-oracle` | Oracle (QA) | Enabled | Only if `SNOW_URL` set |
| With Snowflake | `onsemi-oracle` + `SNOW_URL` | Oracle | Enabled on Oracle | Created as secondary |

## Important Notes

1. **Snowflake is always secondary**: Never the primary datasource for Liquibase
2. **Read-only access**: Snowflake queries are SELECT-only; no mutations attempted
3. **TOTP passwords**: `SNOW_PASS` must be appended with current TOTP token at deployment time
4. **Profile is mandatory**: Without `spring.profiles.active=onsemi-oracle`, app defaults to H2 + disabled Liquibase

