# Workspace Changes Summary

## Files Modified

### 1. `backend/pom.xml`
**Change:** Removed `<scope>provided</scope>` from Snowflake JDBC dependency

**Before:**
```xml
<dependency>
  <groupId>net.snowflake</groupId>
  <artifactId>snowflake-jdbc</artifactId>
  <version>3.27.1</version>
  <scope>provided</scope>  <!-- ❌ Excluded from fat JAR -->
</dependency>
```

**After:**
```xml
<dependency>
  <groupId>net.snowflake</groupId>
  <artifactId>snowflake-jdbc</artifactId>
  <version>3.27.1</version>
  <!-- ✅ Included in fat JAR (default compile scope) -->
</dependency>
```

**Why:** The `<requiresUnpack>` configuration in spring-boot-maven-plugin extracts the JAR from the fat JAR to disk at startup. This requires it to be packaged first. Previously it was excluded with `provided` scope.

---

### 2. `backend/src/main/resources/application.yml`
**Change:** Hardcoded Liquibase as disabled

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

**Why:** Prevents accidental enabling of Liquibase via environment variable. Only the `onsemi-oracle` profile can enable it (via `application-onsemi-oracle.yml`).

---

### 3. `backend/src/main/java/.../config/SnowflakeDataSourceConfig.java`
**Change:** Added info log message when creating secondary datasource

**Added line:**
```java
log.info("Creating secondary Snowflake datasource for pre-check queries (read-only)");
```

**Why:** Makes it clear in logs that Snowflake bean is created separately and won't interfere with Liquibase.

---

## Files Created

### 1. `backend/src/main/java/.../config/DataSourceConfig.java` (NEW)
**Purpose:** Explicit `@Primary` datasource bean to prevent Spring auto-configuration confusion

**Code:**
```java
@Configuration
public class DataSourceConfig {
    @Bean
    @Primary
    @ConfigurationProperties(prefix = "spring.datasource")
    public DataSource primaryDataSource() {
        return DataSourceBuilder.create().build();
    }
}
```

**Why:** 
- Forces Spring to use only the configured datasource
- Prevents auto-detection of multiple drivers (H2, Oracle, Snowflake)
- Binding to `spring.datasource.*` properties means it respects profile overrides
- Liquibase always uses the `@Primary` bean, which will be:
  - H2 (default profile)
  - Oracle (onsemi-oracle profile)

---

## Configuration Files (Reference, Not Changed)

### `backend/src/main/resources/application-onsemi-oracle.yml`
**Already correct**, no changes needed:
```yaml
spring:
  datasource:
    url: jdbc:oracle:thin:@//exnqa-db.onsemi.com:1740/EXNQA.onsemi.com
    username: refdb
    password: "br#^gox66312sdAB"
    driver-class-name: oracle.jdbc.OracleDriver
  liquibase:
    enabled: true
```

---

## File Dependencies

```
DataSourceConfig.java (NEW)
  ↓ uses @Primary on
  └─ spring.datasource.* from application.yml or application-onsemi-oracle.yml

SnowflakeDataSourceConfig.java (MODIFIED)
  ↓ activates only when
  └─ snowflake.url env var is set
  ↓ creates
  └─ snowflakeDataSource bean (NOT @Primary)

application.yml (MODIFIED)
  ↓ hardcoded
  └─ liquibase.enabled: false

application-onsemi-oracle.yml (UNCHANGED)
  ↓ when profile active, overrides with
  └─ liquibase.enabled: true

pom.xml (MODIFIED)
  ↓ packages
  └─ snowflake-jdbc in fat JAR
  ↓ spring-boot-maven-plugin extracts with
  └─ <requiresUnpack>
```

---

## Compilation Status

✅ All Java files: No compile errors
✅ All YAML files: Valid syntax
✅ All imports: Resolved

---

## Rebuild Instructions

```bash
cd backend
mvn clean package -DSkipTests
```

Output JAR: `backend/target/xfcs-reloader-backend-1.0.0-SNAPSHOT.jar`

---

## Deployment Requirements

### Code changes ready: ✅
1. pom.xml updated
2. application.yml updated
3. DataSourceConfig.java created
4. SnowflakeDataSourceConfig.java enhanced

### Systemd service changes required: ⚠️
**Must be done on the server** (not in workspace):

```bash
sudo nano /etc/systemd/system/xfcs-reloader.service
```

Changes:
1. Add: `Environment="SPRING_PROFILES_ACTIVE=onsemi-oracle"`
2. Remove: `-cp /export/home/dpower/jag/xfcs-reloader/lib/snowflake-jdbc-3.27.1.jar`
3. Remove: `--spring.profiles.active=onsemi-oracle` from ExecStart arguments
4. Ensure NO `XFCS_DB_URL` variable is set

Then:
```bash
sudo systemctl daemon-reload
sudo systemctl restart xfcs-reloader
```

---

## Files NOT Changed (For Reference)

- `backend/src/main/resources/application-onsemi-oracle.yml` — Already correct
- All entity/service/repository classes — No business logic changes
- Frontend files — No changes needed (pre-check backend is ready)

