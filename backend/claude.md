# XFCS Reloader — Backend Developer Guide

## Project Purpose

The XFCS Reloader backend is a **Spring Boot 3** REST API that drives the XFCS archive reload workflow. It provides:
- Archive environment discovery (parsing `env.conf` locally or remotely via SSH)
- XFCS archive file search and ZIP download
- Reload session lifecycle management with DB persistence
- JWT-based security (validates tokens issued by `dtp-resender`, does NOT issue tokens)

Backend runs on **port 8005** with context path `/xfcs-reloader`.

---

## Package Structure

```
com.onsemi.cim.apps.exensio.xfcsreloader
├── XfcsReloaderApplication.java         # Spring Boot entry point
│
├── config/
│   ├── AsyncConfig.java                 # ThreadPoolTaskExecutor for async reload jobs
│   ├── EnvConfHealthIndicator.java      # Actuator health indicator for env.conf freshness
│   ├── JwtAuthenticationFilter.java     # Extracts + validates JWT from Authorization header
│   ├── JwtUtil.java                     # JWT parsing/verification (shared secret with DTP)
│   ├── RestAuthenticationEntryPoint.java# Returns 401 JSON on auth failures
│   ├── SecurityConfig.java              # Spring Security filter chain + CORS
│   └── XfcsProperties.java             # @ConfigurationProperties for xfcs.* namespace
│
├── entity/
│   ├── ReloadSessionEntity.java         # JPA entity: xfcs_dearchiver_reload_sessions table
│   └── ReloadSessionEventEntity.java    # JPA entity: xfcs_dearchiver_reload_session_events
│
├── repository/
│   ├── ReloadSessionRepository.java     # Spring Data JPA
│   └── ReloadSessionEventRepository.java
│
├── service/
│   ├── ArchiveSearchService.java        # Walks archive filesystem, finds files by lot ID + env
│   ├── DefaultSshClient.java            # JSch-based SSH client implementation
│   ├── EnvConfigService.java            # Parses env.conf (local or remote), caches with TTL
│   ├── ReloadExecutionService.java      # Dispatches reload jobs asynchronously
│   ├── ReloadSessionService.java        # CRUD for reload sessions + events
│   └── SshClient.java                  # Interface for SSH operations (enables testing)
│
└── web/
    ├── XfcsController.java              # All /api/xfcs/* endpoints
    └── dto/
        ├── ArchiveLotDetail.java        # Lot info in archive
        ├── DashboardData.java           # Aggregate stats
        ├── DownloadFilesRequest.java    # POST body for file ZIP download
        ├── EnvConfCacheInfo.java        # Cache state: source, freshness, TTL
        ├── EnvYearRange.java            # Single env entry from env.conf
        ├── ReloadRequest.java           # POST body to create a reload session
        ├── ReloadSession.java           # Response: session ID
        ├── ReloadSessionEvent.java      # Individual session lifecycle event
        ├── ReloadStatus.java            # Session status: progress, file counts
        └── SearchCriteria.java          # POST body for archive search
```

---

## API Reference

All endpoints require `Authorization: Bearer <jwt>` unless noted. Role values: `ADMIN`, `USER`, `SUPER_ADMIN`.

| Method | Path | Roles | Description |
|--------|------|-------|-------------|
| `GET` | `/api/xfcs/ping` | None | Health probe — returns `{ok: true, ts: "..."}` |
| `GET` | `/api/xfcs/envs` | USER+ | List environments from env.conf (site, area, testerType, year range) |
| `POST` | `/api/xfcs/archive/search` | USER+ | Search archive files by environment + lot IDs |
| `GET` | `/api/xfcs/archive/find-lots` | USER+ | Find lots in archive by lot/wafer filter |
| `POST` | `/api/xfcs/files/download` | USER+ | ZIP selected archive files for download |
| `POST` | `/api/xfcs/reload` | USER+ | Create a reload session with selected files |
| `GET` | `/api/xfcs/reload/{sessionId}` | USER+ | Get session status and progress |
| `GET` | `/api/xfcs/reload/{sessionId}/events` | USER+ | List session lifecycle events |
| `GET` | `/api/xfcs/envs/{environment}/info` | USER+ | Detailed env info (inbox path, file count, cache source) |
| `GET` | `/api/xfcs/dashboard` | USER+ | Aggregate dashboard stats (totals, recent lots) |
| `GET` | `/api/xfcs/cache/info` | ADMIN+ | Env.conf cache state (TTL, source, age) |
| `POST` | `/api/xfcs/cache/refresh` | ADMIN+ | Force env.conf cache refresh |

> **Feature flag guard**: Every endpoint calls `assertFeatureEnabled()`. If `xfcs.feature-enabled=false`, all endpoints return `503 SERVICE_UNAVAILABLE`.

---

## Security Model

Authentication is **validation-only**. The backend:
1. Reads `Authorization: Bearer <token>` from incoming requests
2. Validates the JWT using `reloader.jwt.secret` (must match the DTP resender issuer secret)
3. Extracts `roles` claim — maps to Spring Security `GrantedAuthority` entries
4. Never issues tokens — login always goes to the **DTP Resender** backend (`/resender/api/auth`)

CORS is configured via `security.allowed-origins` (comma-separated). Default: `http://localhost:4200,http://localhost:5173`.

---

## Database

**Shared schema** with `dtp-resender-fullstack`. The XFCS app adds two tables via Liquibase:

| Table | Description |
|-------|-------------|
| `xfcs_dearchiver_reload_sessions` | Reload session records (id, env, status, file counts, timestamps) |
| `xfcs_dearchiver_reload_session_events` | Per-session lifecycle events (eventType, message, errorCode) |

Liquibase changelogs are in `src/main/resources/db/changelog/`:
- `db.changelog-5.0-reload-sessions.xml` — base table
- `db.changelog-5.1-reload-sessions-enhancement.xml` — added file count columns
- `db.changelog-5.2-reload-session-events.xml` — events table
- `db.changelog-5.9-pending-files-exensio.xml` — added Exensio verification keys

**Driver defaults**: H2 in-memory for local development. Set env vars to use Oracle in production.

---

## Configuration

### application.yml key properties

```yaml
server:
  port: 8005
  servlet.context-path: /xfcs-reloader

xfcs:
  feature-enabled: true           # Master kill-switch for all /api/xfcs/* endpoints
  archives-root: /archives         # Root path where archive folders live
  search-max-results: 200
  search-max-files-scan: 20000
  env-conf-cache-ttl-sec: 120     # Cache TTL in seconds
  env-conf-retries: 2
  remote-enabled: true            # Enable SSH remote env.conf retrieval
  remote-host: usaz15ls082
  remote-port: 22
  remote-user: dpower
  remote-env-conf-path: /export/home/dpower/project/scripts/dearchive/env.conf

reloader:
  jwt.secret: ${RELOADER_JWT_SECRET:dev-secret-change-me-please-32-bytes}

exensio:
  enabled: ${EXENSIO_ENABLED:false}  # Automatically verify reloads via Exensio API
  env: ${EXENSIO_ENV:QA}
  qa-url: ${EXENSIO_QA_URL:}
  prod-url: ${EXENSIO_PROD_URL:}
  username: ${EXENSIO_USERNAME:}
  password: ${EXENSIO_PASSWORD:}
  timeout-minutes: 60
```

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `RELOADER_JWT_SECRET` | JWT HMAC secret — must match the DTP resender secret |
| `XFCS_DB_URL` | JDBC URL for shared Oracle DB |
| `XFCS_DB_USERNAME` / `XFCS_DB_PASSWORD` | DB credentials |
| `XFCS_DB_DRIVER` | JDBC driver class (use `oracle.jdbc.OracleDriver` for production) |
| `XFCS_FEATURE_ENABLED` | `true`/`false` — toggles all XFCS endpoints |
| `XFCS_ARCHIVES_ROOT` | Filesystem root for archive folders |
| `XFCS_REMOTE_ENABLED` | `true`/`false` — enable SSH env.conf retrieval |
| `XFCS_REMOTE_PASSWORD` | SSH password (or use `XFCS_REMOTE_PRIVATE_KEY_PATH`) |
| `XFCS_REMOTE_STRICT_HOST_KEY` | `true` (prod) / `false` (dev) |

---

## Remote env.conf Retrieval

`EnvConfigService` retrieves the env.conf over SSH when `xfcs.remote-enabled=true`:
1. **SSH connection** to `usaz15ls082` as `dpower` (key or password auth)
2. **Retry with backoff**: up to `env-conf-retries` attempts separated by `env-conf-retry-backoff-ms`
3. **TTL cache**: parsed result cached for `env-conf-cache-ttl-sec` seconds
4. **Stale fallback**: if remote fetch fails, returns last successful cache even if expired
5. **Health indicator**: `/actuator/health` includes `envConf` component showing `source`, `age`, `cacheKey`

Cache can be inspected via `GET /api/xfcs/cache/info` and force-refreshed via `POST /api/xfcs/cache/refresh` (ADMIN role required).

---

## Archive Search Logic

`ArchiveSearchService.search(criteria)`:
1. Resolves matching environments from `envConfigService.loadEnvs()`
2. For each environment folder under `xfcs.archives-root/{env}/`: walks tree up to `search-max-files-scan` files
3. Matches filename by lot ID (partial match)
4. Returns up to `search-max-results` `SearchResult` objects with `{path, lotId, filename, year, month}`

`ArchiveSearchService.zipSelected(paths)`:
- Reads each file from filesystem and wraps in a `ZipOutputStream`
- Returned as `byte[]` for direct HTTP streaming

---

## Reload Session Lifecycle

States: `QUEUED` → `RUNNING` → `COMPLETED` / `FAILED` / `PARTIALLY_FAILED`

1. `POST /api/xfcs/reload` → creates `ReloadSessionEntity`, status `QUEUED`
2. `ReloadExecutionService` picks up and processes asynchronously (Spring `@Async`)
3. `ReloadSessionEventEntity` records are appended for each file processed
4. Polling: frontend calls `GET /api/xfcs/reload/{id}` every 3.5 seconds until terminal status

---

## Build & Run

```powershell
# Build (from backend/ directory)
cd c:\Users\fg8n8x\Desktop\eta\xfcs-reloader-fullstack\backend
mvn clean package -DskipTests

# Run locally (H2 in-memory, env.conf from SSH)
mvn spring-boot:run

# Run JAR directly
java -jar target/xfcs-reloader-*.jar

# With environment overrides
$env:RELOADER_JWT_SECRET="your-shared-secret"
$env:XFCS_FEATURE_ENABLED="true"
$env:XFCS_DB_URL="jdbc:oracle:thin:@//host:1521/sid"
java -jar target/xfcs-reloader-*.jar
```

---

## Health & Observability

- **Actuator**: `GET /xfcs-reloader/actuator/health` — includes `db`, `diskSpace`, `envConf`
- **Ping**: `GET /xfcs-reloader/api/xfcs/ping` — no auth, quick availability check
- **Env.conf health**: reported in actuator with `source` (LOCAL/REMOTE/STALE), `ageSeconds`, `entryCount`

---

## Adding New Endpoints

1. Add route in `XfcsController.java` — apply `@PreAuthorize` with appropriate role
2. Add business logic to existing or new service in `service/`
3. Add DTO record in `web/dto/` if new request/response shape is needed
4. Call `assertFeatureEnabled()` at the top of the handler
5. If new DB tables needed: add Liquibase changelog XML in `db/changelog/`, register in `db.changelog-master.xml`

---

## Key Design Constraints

- **Never issue JWT** — only validate. Login is always at `/resender/api/auth/login`
- **Shared DB schema** — XFCS changelogs must never drop or alter auth/user tables
- **Feature flag** — always keep `assertFeatureEnabled()` calls for safe rollback
- **Cache + stale fallback** — env.conf must never hard-fail the API; always fall back to stale cache

---

## Old Backend Architecture Reference

> Source: `C:\Users\fg8n8x\Desktop\eta\new_ed\backend` (package `exensioDearchiver`)

### Environment Folder Resolution Chain

The old backend resolves an environment's **dearchive folder** (where files are staged for ETL pickup) and **dataflow staging folder** (the raw inbox path for the ETL pipeline) through a 3-step chain:

```
User: "Reload files for CPFT_EAGLE"
      ↓
1. MgrConfigParser reads envs.mgr
   → finds: $DPLOAD/fcs_pp_cpft_eagle.cfg : <options> : CPFT_EAGLE
      ↓
2. CfgFileParser reads the .cfg file
   → extracts first colon-delimited field:
     $DPDATA/data/cpft_eagle/inbox/Processed
      ↓
3. EnvFolderResolver expands env vars ($DPDATA → /apps/exensio_data)
   → strips processing suffixes (/Processed, /NotProcessed, /dearchive)
   → result: /apps/exensio_data/data/cpft_eagle/inbox
      ↓
4. XfcsReloadService stages files to:
   → dearchiveDir = {resolvedInbox}/dearchive/
   → finalDir = {resolvedInbox}/
```

### Key File Formats

**`.mgr` file** (`envs.mgr` — maps env names to `.cfg` files):
```
# Format: <cfg_path> : <options> : <environment_name>
$DPLOAD/fcs_pp_cpft_eagle.cfg : -mtime -log $DPLOG/fcs_pp_cpft_eagle.cfg.log -sleep 60 : CPFT_EAGLE
$DPLOAD/fcs_pp_bksort_eagle.cfg : -mtime -log $DPLOG/fcs_pp_bksort_eagle.cfg.log -sleep 60 : BKSORT_EAGLE
```

**`.cfg` file** (contains inbox path as first colon-delimited field):
```
$DPDATA/data/cpft_eagle/inbox/Processed:$DPSCRIPT/fcs_eagle_log_IFF.pl:%: --site cpft --loc CP --out /archives-yms/data/cpft_eagle
```
- **Inbox path** = first field before `:` → `$DPDATA/data/cpft_eagle/inbox/Processed`
- **Outbox path** = extracted from `--out` flag → `/archives-yms/data/cpft_eagle`
- **Location code** = from `--loc` flag → `CP`

### Environment Variables

| Variable | Default Value | Purpose |
|----------|--------------|---------|
| `DPDATA` | `/apps/exensio_data` | Base path for environment data folders |
| `DPLOAD` | `/export/home/dpower/project/scripts/load` | Directory containing `.cfg` files |
| `DPSCRIPT` | `/export/home/dpower/project/scripts` | ETL scripts directory |
| `DPLOG` | `/apps/exensio_data/log` | ETL log files directory |
| `XFCS_MGR_FILE_PATH` | `/export/home/dpower/project/scripts/dearchive/envs.mgr` | Path to the `.mgr` file |

### Old XfcsProperties Key Config

| Property | Default | Purpose |
|----------|---------|---------|
| `xfcs.archives-root` | `/archives` | Root of archive filesystem (NFS mount) |
| `xfcs.data-root` | `/apps/exensio_data/data` | Root of environment data folders |
| `xfcs.staging-folder` | `dearchive` | Subdirectory name for staging files before ETL pickup |
| `xfcs.mgr-file-path` | `fcs_all_load.mgr` | Path to the `.mgr` mapping file |
| `xfcs.active-check-folder` | `Processed` | Folder name to check for ETL activity |
| `xfcs.pending-monitor-interval-sec` | `2` | Background poll interval for pending file monitor |

### Reload File Staging Flow

```
1. reloadFileToEnv(source, sessionId, requester, environment)
   │
   ├→ resolveEnvDestinationFolder(env)                    # resolves via .mgr/.cfg chain
   │   └→ returns /apps/exensio_data/data/cpft_eagle/inbox
   │
   ├→ dearchiveDir = finalDir + "/dearchive"              # staging subfolder
   │
   ├→ copy source → dearchiveDir/filename.gz              # raw copy
   ├→ if .gz: unzip → dearchiveDir/filename.LOG           # decompress
   ├→ delete .gz original
   │
   ├→ transform filename: strip MD5 hash, add _reloaded_yyyyMMddHHmmss
   │   Example: P002873977_FT_ZBNV6B_ETS104123_12222025_MD5-1195a55b...LOG.gz
   │         → P002873977_FT_ZBNV6B_ETS104123_12222025_reloaded_20260109143022.LOG
   │
   └→ copy to finalDir (inbox root), delete from dearchive
```

### Background Pending File Monitor

The backend runs a `ReloadPendingMonitor` (scheduled task) that tracks file staging. It includes an integrated **Exensio Verification Sequence**:

```text
scanPendingFiles():
  for each pending file entry:
    │
    ├→ findFileRecursively(envRoot, fileName)
    │
    ├→ if found in /Processed/ subfolder:
    │     → if exensio.enabled = false:
    │          → mark `completed`
    │     → if exensio.enabled = true:
    │          → mark `exensio_loading` (wait for DB ingestion)
    │
    ├→ if found in /NotProcessed/ subfolder:
    │     → emit "file_failed" event with NOTPROCESSED error
    │
    └→ if not found anywhere:
          → emit "file_staging" event (still waiting for ETL)

processExensioLoading():
  collate all `exensio_loading` files:
    │
    ├→ fire batch request `ExensioClient.searchLotWaferByBatch()`
    │
    ├→ if found in Exensio:
    │     → copy `pgKey` and `waferKey` to `ReloadPendingFileEntity`
    │     → mark `completed`
    │
    └→ if not found and timeout reached:
          → mark `failed` (exensio_timeout)
```

**Exensio API Sequence details:**
- **Dynamic Login / Grouping**: Exensio requires the destination schema (`PRODUCTION` or `SANDBOX`) during the `/v1/session/login` call. `ExensioClient` dynamically groups the `exensio_loading` files by their final `destinationFolder`, grabs the corresponding schema-specific JWT token, and fires batch HTTP lookups for each group.
- **Polling Frequency**: Verification runs synchronously every `xfcs.pending-monitor-interval-sec` (runs continually on a fast loop, commonly 1-10 seconds depending on environment).
- **Time Allocated**: Files stuck with `NOT FOUND` from the Exensio API are preserved until they reach an age of `exensio.timeout-minutes` (defaults to 60). After 60 minutes, the orchestrator gives up and records `FAILED` via a timeout event.

### Old vs New Backend: Key Differences

| Aspect | Old (`exensioDearchiver`) | New (`xfcsreloader`) |
|--------|--------------------------|---------------------|
| Package | `exensioDearchiver` | `xfcsreloader` |
| Port | `8003` | `8005` |
| Context path | `/exensio-dearchiver` | `/xfcs-reloader` |
| Env discovery | `env.conf` + remote SSH scan | `env.conf` (local or SSH) |
| Folder resolution | `.mgr` → `.cfg` → inbox path | **Not yet implemented** |
| Reload staging | Copy to `inbox/dearchive/`, then `inbox/` | **Not yet implemented** |
| File monitor | Background `ScheduledExecutorService` | `ReloadPendingMonitor` (Spring `@Scheduled`) with Exensio API support |
| Archive search | Local FS + remote Python SSH script | Local FS only |
| Auth | LDAP / SSO with roles | JWT validation only |
| DB | H2/Oracle with Liquibase | H2/Oracle with Liquibase |

### Migration TODO (from old → new)

- [ ] Port `EnvFolderResolver` (`.mgr` → `.cfg` → inbox resolution)
- [ ] Port `MgrConfigParser` + `CfgFileParser` utilities
- [ ] Port `XfcsReloadService.reloadFileToEnv()` (copy + gunzip + rename + stage)
- [x] Port background `scanPendingFiles()` monitor (Processed/NotProcessed detection)
- [x] Add Exensio API confirmation flow matching `dtp-resender-fullstack`
- [ ] Port `XfcsProperties` config: `staging-folder`, `mgr-file-path`, env var expansion
- [ ] Port multi-server SSH support (`ServerConfig` list in `XfcsProperties`)



Here are the details on how the Exensio API confirmation process works, including its polling frequency and timeout allocation:

1. How It Checks (The Verification Sequence)
Whenever a file is fully processed by the ETL and placed into either the PRODUCTION or SANDBOX output locations, the file enters an exensio_loading state in the database.

The background system checks its status via the Exensio API using these steps:

Dynamic Login: The system groups all loading files by their target destination (PRODUCTION or SANDBOX). It calls /v1/session/login using the specific schema to obtain a secure token.
Batch Lookup: It then sends a single, bundled HTTP request to the /v1/key/lot-wafer-lookup endpoint containing all the user lot strings (lot_ids) that pertain to that specific destination.
Result Matching:
If Exensio confirms the lot string and returns a valid pg_key (and wafer_key if applicable), the backend saves these keys to the database and marks the file processing as completely completed.
If Exensio returns exactly NOT FOUND, it means the internal Exensio database hasn't digested the ETL file yet. The system leaves the file in the exensio_loading state to be retried on the next loop.
2. How Often It Checks (Polling Frequency)
The Exensio API check is integrated directly into the 

ReloadPendingMonitor
 loop. The monitor operates under a fixed-delay scheduled interval.

Interval configuration: The frequency is controlled by the xfcs.pending-monitor-interval-sec property in your 

application.yml
.
Default behavior: If not explicitly set, it defaults to polling every several seconds (depending on your environment preset, but typically around 5 to 10 seconds). This means an API verification batch will fire every 5-10 seconds for any file actively waiting.
3. Time Allocated (The Timeout Window)
Because checking cannot go on infinitely if a file is truly stuck, there is a maximum time allocation before the API check gives up.

Timeout configuration: The time allocated is controlled by the exensio.timeout-minutes property in 

application.yml
.
Default allocation: The default allocation is 60 minutes.
What happens on timeout: If a file has been actively monitored for over 60 minutes since its creation and Exensio still repeatedly reports NOT FOUND, the system considers it lost. It halts checking and marks the file as failed with the reason "Exensio load timeout — not found after 60 mins".