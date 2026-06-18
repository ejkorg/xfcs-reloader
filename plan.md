# XFCS Reloader Full-Stack Implementation Plan

## Final Decisions (Confirmed)
- Create a standalone app in this folder: `xfcs-reloader-fullstack`.
- Backend folder path: `C:\Users\fg8n8x\Desktop\eta\xfcs-reloader-fullstack\backend`.
- Frontend folder path: `C:\Users\fg8n8x\Desktop\eta\xfcs-reloader-fullstack\frontend`.
- Use **same shared DB schema** as `dtp-resender-fullstack`.
- Existing users from `dtp-resender-fullstack` must log in directly to XFCS Reloader.
- Keep `dtp-resender` as the **token issuer**; XFCS backend will **validate JWT** and enforce roles.
- Reuse visual style and app shell patterns from `dtp-resender-fullstack/new_frontend`.

## Implementation Status (Executed)

### Created target structure
- `C:\Users\fg8n8x\Desktop\eta\xfcs-reloader-fullstack\backend`
- `C:\Users\fg8n8x\Desktop\eta\xfcs-reloader-fullstack\frontend`

### Backend scaffold completed
- Spring Boot project initialized with JWT validation security and XFCS API routes.
- Added core endpoints under `/api/xfcs`:
   - `GET /ping`
   - `GET /envs`
   - `POST /archive/search`
   - `POST /files/download`
   - `POST /reload`
   - `GET /reload/{sessionId}`
   - `GET /dashboard`
- Added `env.conf` parsing service and in-memory reload session service.

### Frontend scaffold completed
- Angular standalone app initialized with shared-style shell and auth integration points.
- Added DTP-auth compatible login/token flow using `/resender/api/auth/*`.
- Added XFCS feature page and API service using `/xfcs-reloader/api/xfcs/*`.
- Added proxy config for both XFCS backend and DTP auth backend.

### Next execution batch
1. Replace backend in-memory reload sessions with DB persistence tables in shared schema.
2. Wire real archive search/download/reload logic from `new_ed` service behavior.
3. Port additional XFCS dialogs/pages from `new_ed/frontend/src/app/xfcs`.
4. Add Liquibase changelog chain aligned to shared schema policy.
5. Run full build/test verification (`mvn`, `npm`) in this folder.

## Progress Update (Latest)

Completed from the next execution batch:
- ✅ Replaced in-memory reload session tracking with JPA persistence (`xfcs_dearchiver_reload_sessions`).
- ✅ Added Liquibase changelog chain and master include under `backend/src/main/resources/db/changelog`.
- ✅ Added backend datasource/JPA/Liquibase configuration with shared-schema env vars and local H2 fallback.
- ✅ Implemented filesystem-based archive search and ZIP download service (`ArchiveSearchService`).
- ✅ Added frontend route feature guard based on `environment.featureFlags.xfcsReloaderEnabled`.

Remaining:
- ⏳ Port remaining advanced XFCS dialogs from `new_ed/frontend/src/app/xfcs/*` (partial completed).
- ⏳ Connect reload processing lifecycle/events to actual external archive reload execution.
- ⏳ Run full build and runtime verification in this workspace.

## Further Considerations Implementation (Completed)

- ✅ Implemented secure remote env.conf retrieval over SSH with key-based auth and strict host-key mode.
- ✅ Added retry/backoff + TTL cache + stale fallback strategy for env.conf loading.
- ✅ Added admin endpoints for cache observability and manual refresh:
   - `GET /api/xfcs/cache/info`
   - `POST /api/xfcs/cache/refresh`
- ✅ Added actuator health indicator for env.conf source/freshness/error visibility.
- ✅ Added configuration model for production remote host:
   - `usaz15ls082.onsemi.com`
   - `/export/home/dpower/project/scripts/dearchive/env.conf`

## XFCS Dialog Ecosystem Port (Partial Completed)

- ✅ Added dialog components:
   - `SearchResultsDialogComponent`
   - `EnvInfoDialogComponent`
   - `FindArchiveLotsDialogComponent`
- ✅ Integrated dialogs into `XfcsComponent` actions/workflow.
- ✅ Added backend support endpoints:
   - `GET /api/xfcs/envs/{environment}/info`
   - `GET /api/xfcs/archive/find-lots`
- ✅ Added frontend API/model contracts for env info + archive lot detail lookups.

## UI/UX Modernization (Stepper Monitoring-Inspired)

- ✅ Upgraded XFCS main page to a monitoring-first layout inspired by `dtp-resender-fullstack/new_frontend` Stepper Step 3 patterns:
   - Hero command bar with quick actions
   - Monitoring stats cards
   - Progress bar for current reload session
   - Monitoring file list table
   - Recent activity feed panel
- ✅ Added workflow activity logging for key user/system actions (load/search/reload/status refresh).

## Goal
Recreate only the XFCS Reloader full-stack app with:
1. XFCS domain/API behavior from `new_ed`.
2. Auth/AuthZ compatibility from `dtp-resender-fullstack` backend.
3. Modern UI styling/patterns from `new_frontend`.

---

## Phase 1 — Project Scaffolding

### Backend target
Create backend project structure under:
- `xfcs-reloader-fullstack/backend`

Seed with baseline from:
- `new_ed/backend/pom.xml`
- `new_ed/backend/src/main/resources/application.yml`
- `new_ed/backend/Dockerfile`

### Frontend target
Create frontend project structure under:
- `xfcs-reloader-fullstack/frontend`

Seed with baseline from:
- `dtp-resender-fullstack/new_frontend/package.json`
- `dtp-resender-fullstack/new_frontend/angular.json`
- `dtp-resender-fullstack/new_frontend/src/main.ts`

---

## Phase 2 — Backend XFCS Domain Port

Port XFCS API and services from `new_ed` into target backend:
- `new_ed/backend/docs/xfcs-api-spec.md`
- `new_ed/backend/src/main/java/.../web/XfcsController.java`
- `new_ed/backend/src/main/java/.../service/XfcsArchiveService.java`
- `new_ed/backend/src/main/java/.../service/XfcsReloadService.java`
- `new_ed/backend/src/main/java/.../service/XfcsDashboardService.java`
- `new_ed/backend/src/main/java/.../service/EnvFolderResolver.java`
- `new_ed/backend/src/main/java/.../config/XfcsProperties.java`

Initial scope parity:
- `GET /api/xfcs/envs`
- `POST /api/xfcs/archive/search`
- `POST /api/xfcs/files/download`
- `POST /api/xfcs/reload`
- `GET /api/xfcs/reload/{sessionId}`
- `GET /api/xfcs/dashboard`

---

## Phase 3 — Auth/AuthZ + Shared DB Compatibility

Adopt validation-side security from `dtp-resender-fullstack`:
- `dtp-resender-fullstack/backend/src/main/java/.../config/SecurityConfig.java`
- `dtp-resender-fullstack/backend/src/main/java/.../config/JwtAuthenticationFilter.java`
- `dtp-resender-fullstack/backend/src/main/java/.../config/JwtUtil.java`
- `dtp-resender-fullstack/backend/src/main/java/.../config/RestAuthenticationEntryPoint.java`

Rules:
- XFCS backend validates JWT and applies role checks.
- DTP backend remains auth issuer (`login`/`refresh`).
- Keep same claim conventions and secret/issuer settings for compatibility.

### DB changelog strategy (same schema)
Use compatible auth/user schema chain plus XFCS tables:
- Auth/user related changelogs aligned with DTP/new_ed compatibility.
- XFCS-specific reload/session changelogs added in target backend.

Outcome:
- Existing users in shared DB authenticate to XFCS without re-registration.

---

## Phase 4 — Frontend Shell + Styling (from new_frontend)

Reuse layout/theme patterns from:
- `dtp-resender-fullstack/new_frontend/src/app/app.ts`
- `dtp-resender-fullstack/new_frontend/src/app/app.routes.ts`
- `dtp-resender-fullstack/new_frontend/src/app/app.html`
- `dtp-resender-fullstack/new_frontend/src/app/app.scss`
- `dtp-resender-fullstack/new_frontend/src/styles.scss`

Keep visual consistency:
- Typography, spacing, card/dialog look, and route shell behavior.

---

## Phase 5 — XFCS Frontend Feature Port

Port XFCS feature/API client from `new_ed/frontend`:
- `new_ed/frontend/src/app/api/xfcs-api.service.ts`
- `new_ed/frontend/src/app/api/xfcs-models.ts`
- `new_ed/frontend/src/app/xfcs/*`

Integrate with target shell/routes:
- Add `/xfcs` route in target frontend.
- Protect route with auth guard.
- Use existing interceptor pattern for bearer token forwarding.

---

## Phase 6 — Config, Cutover, and Safety Toggles

### Backend toggles
- Add properties to enable/disable XFCS endpoints quickly (rollback safety).

### Frontend feature toggle
- Add `features.xfcsReloaderEnabled` in environment config.
- Route-level conditional enablement for controlled rollout.

### Cutover strategy
1. Deploy with feature off.
2. Validate auth + role + API parity in staging.
3. Enable feature for pilot users.
4. Full enablement after verification.

---

## Validation Checklist

### Backend
- Build success.
- Security filter validates DTP-issued JWT.
- Role-based access works for XFCS endpoints.
- Liquibase migration runs on shared schema with no auth/user regressions.

### Frontend
- Build success.
- Login/session flows operate with shared users.
- XFCS pages render with target styling.
- API calls succeed and handle errors consistently.

### Integration
- Existing DTP user logs in and uses XFCS flow end-to-end.
- Dashboard/reload status updates function correctly.

---

## Risks and Mitigations

1. **JWT drift between apps**
   - Mitigation: keep DTP as single issuer; XFCS only validates.

2. **Shared-schema migration conflict**
   - Mitigation: strict changelog ordering and pre-deploy migration test.

3. **XFCS filesystem/archive dependency instability**
   - Mitigation: keep resolver and cache behavior from `new_ed`; add health checks.

4. **Frontend behavior mismatch after styling reuse**
   - Mitigation: port shell first, then XFCS feature module incrementally.

---

## Implementation Sequence (Actionable)
1. Scaffold `backend/` and `frontend/` target projects.
2. Port backend XFCS APIs/services.
3. Integrate DTP-compatible security validation.
4. Align Liquibase changelogs for shared schema.
5. Port frontend shell/theme from `new_frontend`.
6. Port XFCS feature pages/services.
7. Add feature toggles and route guards.
8. Run end-to-end validation with existing DTP user account.
9. Roll out in staged cutover.
