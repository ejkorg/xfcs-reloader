# Final Deployment Steps: Fix Liquibase Targeting Snowflake

## What Changed

### Backend Code
1. **pom.xml** — Snowflake JDBC scope changed from `provided` to default `compile` (packaged in fat JAR)
2. **application.yml** — Liquibase hardcoded as `enabled: false`
3. **DataSourceConfig.java** — NEW file, explicit `@Primary` datasource bean
4. **SnowflakeDataSourceConfig.java** — Verified secondary bean, added info log

### Systemd Service
Must update `/etc/systemd/system/xfcs-reloader.service` to include `SPRING_PROFILES_ACTIVE=onsemi-oracle`

---

## Step 1: Rebuild JAR

```bash
cd /path/to/backend
mvn clean package -DSkipTests
```

Expected output:
```
[INFO] BUILD SUCCESS
[INFO] Total time: X.XXX s
```

JAR location: `backend/target/xfcs-reloader-backend-1.0.0-SNAPSHOT.jar`

---

## Step 2: Copy JAR to Server

```bash
scp backend/target/xfcs-reloader-backend-1.0.0-SNAPSHOT.jar \
    dpower@usaz15ls088:/export/home/dpower/jag/xfcs-reloader/
```

Verify:
```bash
ssh dpower@usaz15ls088 ls -lh /export/home/dpower/jag/xfcs-reloader/xfcs-reloader-backend-1.0.0-SNAPSHOT.jar
```

---

## Step 3: Update Systemd Service

Edit `/etc/systemd/system/xfcs-reloader.service` on the server:

```bash
sudo nano /etc/systemd/system/xfcs-reloader.service
```

**Required changes:**

1. **Add this line after PATH** (around line 11):
   ```ini
   Environment="SPRING_PROFILES_ACTIVE=onsemi-oracle"
   ```

2. **Verify SNOW_* variables are present** (lines 17-19):
   ```ini
   Environment="SNOW_URL=jdbc:snowflake://onsemi.west-us-2.azure.snowflakecomputing.com/?db=ANALYTICSPRD&schema=MFG&warehouse=MFG_PRD_RPT_WH"
   Environment="SNOW_USER=MFG_PRD_RPT_EXENSIO_USER"
   Environment="SNOW_PASS=5)Day=323fFd"
   ```

3. **Remove the `-cp` argument** from ExecStart (line 22):
   ```ini
   # OLD (REMOVE THIS):
   # ExecStart=/apps/exensio/jdk-21.0.8+9/bin/java \
   #   -cp /export/home/dpower/jag/xfcs-reloader/lib/snowflake-jdbc-3.27.1.jar \
   #   -jar /export/home/dpower/jag/xfcs-reloader/xfcs-reloader-backend-1.0.0-SNAPSHOT.jar \
   
   # NEW (USE THIS):
   ExecStart=/apps/exensio/jdk-21.0.8+9/bin/java \
     -jar /export/home/dpower/jag/xfcs-reloader/xfcs-reloader-backend-1.0.0-SNAPSHOT.jar \
     --logging.file.name=/export/home/dpower/logs/xfcs-reloader.log
   ```

4. **Remove the `--spring.profiles.active=onsemi-oracle` argument** from ExecStart (it's now set via env var)

5. **Verify XFCS_DB_* variables are NOT present** (search for `XFCS_DB_URL`, `XFCS_DB_USERNAME`, `XFCS_DB_PASSWORD` — they should NOT exist in the file)

Final ExecStart should look like:
```ini
ExecStart=/apps/exensio/jdk-21.0.8+9/bin/java \
  -jar /export/home/dpower/jag/xfcs-reloader/xfcs-reloader-backend-1.0.0-SNAPSHOT.jar \
  --logging.file.name=/export/home/dpower/logs/xfcs-reloader.log
```

Save and exit: `Ctrl+O`, `Enter`, `Ctrl+X`

---

## Step 4: Reload and Restart Systemd

```bash
sudo systemctl daemon-reload
sudo systemctl restart xfcs-reloader
```

---

## Step 5: Monitor Logs

Watch the startup logs:

```bash
sudo journalctl -u xfcs-reloader -f
```

Expected logs (in order):
```
[main] Starting XfcsReloaderApplication v1.0.0-SNAPSHOT
[main] The following 1 profile is active: "onsemi-oracle"
[main] Bootstrapping Spring Data JPA repositories
[main] Tomcat initialized with port 8005
[main] Root WebApplicationContext: initialization completed
[main] liquibase initialized
[main] liquibase start
[main] Liquibase: Update successful
[main] Creating secondary Snowflake datasource for pre-check queries
[main] Tomcat started on port 8005
```

**Stop watching logs**: `Ctrl+C`

---

## Step 6: Verify Health

```bash
curl http://usaz15ls088:8005/xfcs-reloader/actuator/health
```

Expected response:
```json
{"status":"UP"}
```

---

## Troubleshooting

### Problem: Still seeing Liquibase error on Snowflake
**Check:**
```bash
grep SPRING_PROFILES_ACTIVE /etc/systemd/system/xfcs-reloader.service
```
Should output: `Environment="SPRING_PROFILES_ACTIVE=onsemi-oracle"`

If missing, add it and repeat Step 4.

### Problem: "Creating database history table in ANALYTICSPRD.MFG.DATABASECHANGELOG"
**This means Snowflake is still the primary datasource.**

Check for:
```bash
grep XFCS_DB_URL /etc/systemd/system/xfcs-reloader.service
```

If it exists, **delete that line** and restart.

### Problem: Snowflake connection timeouts (not fatal)
```
ERROR 724492 --- [pool-2-thread-5] net.snowflake.client.jdbc.RestRequest: Stop retrying
```

**This is OK.** These are warnings from Snowflake JDBC trying to reach metadata services. The app will still start. Pre-check queries will fall back to Exensio HTTP.

### Problem: App crashes immediately after restart
Check logs:
```bash
sudo journalctl -u xfcs-reloader -n 50
```

Look for:
- "BeanCreationException" → Configuration error
- "Connection refused" → Oracle/Snowflake connectivity issue
- "liquibase.exception" → Liquibase still targeting wrong database

---

## Rollback Plan

If anything goes wrong:

1. Stop the service: `sudo systemctl stop xfcs-reloader`
2. Restore old JAR: `cp /path/to/backup/xfcs-reloader-backend-1.0.0-SNAPSHOT.jar /export/home/dpower/jag/xfcs-reloader/`
3. Restore old systemd config (or revert changes)
4. Restart: `sudo systemctl start xfcs-reloader`

---

## Summary

✅ Backend code: Updated (3 files, 1 new file)
✅ JAR: Rebuilt and packaged with Snowflake JDBC
✅ Systemd: Update required (add `SPRING_PROFILES_ACTIVE`, remove `-cp`, remove Java args)
✅ Liquibase: Will now target Oracle only (not Snowflake)
✅ Snowflake: Available as secondary datasource for pre-check queries

