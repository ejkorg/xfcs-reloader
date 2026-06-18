# XFCS Reloader Backend

Spring Boot backend for XFCS reload APIs.

## Run
- `mvn spring-boot:run`

Base URL:
- `http://localhost:8005/xfcs-reloader`

API base:
- `/api/xfcs`

Auth model:
- Validates JWT from DTP auth issuer.
- Shared DB schema compatibility is preserved at token/role contract level.

## Shared schema DB configuration
Set these environment variables to point to the same schema used by DTP:
- `XFCS_DB_URL`
- `XFCS_DB_USERNAME`
- `XFCS_DB_PASSWORD`
- `XFCS_DB_DRIVER` (example: `oracle.jdbc.OracleDriver`)

Liquibase changelog:
- `src/main/resources/db/changelog/db.changelog-master.xml`

Primary reload table aligned to existing schema naming:
- `xfcs_dearchiver_reload_sessions`

## Remote env.conf (recommended production mode)

This backend supports secure remote loading of:
- `/export/home/dpower/project/scripts/dearchive/env.conf`

Recommended environment variables:
- `XFCS_REMOTE_ENABLED=true`
- `XFCS_REMOTE_HOST=usaz15ls082.onsemi.com`
- `XFCS_REMOTE_PORT=22`
- `XFCS_REMOTE_USER=dpower`
- `XFCS_REMOTE_ENV_CONF_PATH=/export/home/dpower/project/scripts/dearchive/env.conf`
- `XFCS_REMOTE_PRIVATE_KEY_PATH=/secure/path/id_rsa`
- `XFCS_REMOTE_PASSWORD=<optional-password-if-key-not-used>`
- `XFCS_REMOTE_KNOWN_HOSTS_PATH=/secure/path/known_hosts`
- `XFCS_REMOTE_STRICT_HOST_KEY=true`

Resilience knobs:
- `XFCS_ENV_CONF_CACHE_TTL_SEC`
- `XFCS_ENV_CONF_RETRIES`
- `XFCS_ENV_CONF_RETRY_BACKOFF_MS`
- `XFCS_REMOTE_CONNECT_TIMEOUT_MS`
- `XFCS_REMOTE_READ_TIMEOUT_MS`

Operational endpoints:
- `GET /api/xfcs/cache/info`
- `POST /api/xfcs/cache/refresh`

Actuator health includes env.conf source/freshness details.
