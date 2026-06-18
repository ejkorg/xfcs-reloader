# Reload Monitoring Overhaul — Implementation Summary

## What Changed

Replaced HTTP polling with Server-Sent Events (SSE), consolidated backend monitoring logic, added per-file status tracking, stuck-session auto-timeout, session cancellation, persistent activity feed, and dashboard enhancements.

---

## Backend

### New Files

| File | Purpose |
|---|---|
| `service/SseEventBroker.java` | Spring component managing per-session SSE emitters. Provides `subscribe(sessionId, lastEventId)`, `publish(sessionId, event)`, and `complete(sessionId)`. Replays missed events on reconnect via Last-Event-ID. |
| `web/dto/FileStatusDto.java` | DTO for per-file status: `absPath`, `fileName`, `userLotId`, `fileStatus`, `errorReason`, `createdAt`, `resolvedAt`. |
| `db/changelog/db.changelog-5.6-pending-files-status.xml` | Liquibase migration adding `file_status VARCHAR(32) DEFAULT 'pending'`, `error_reason VARCHAR(2000)`, `resolved_at TIMESTAMP` to `xfcs_dearchiver_reload_pending_files`. |

### Modified Files

**`ReloadPendingMonitor.java`**
- Now the single authoritative component for all pending-file scanning and session finalization.
- Sets `file_status` on each `ReloadPendingFileEntity`: `pending` → `staging` → `completed` / `failed`.
- Populates `errorReason` from `.err` sibling files; sets `resolvedAt` on resolution.
- Calls `SseEventBroker.publish()` on every event append.
- Calls `SseEventBroker.complete()` when a session is finalized.
- Added `checkStuckSessions()` called at the end of each scan cycle.

**`ReloadExecutionService.java`**
- Removed all duplicate monitoring methods: `scanPendingFiles`, `findFileWithCommand`, `findFileInTree`, `finalizeSessionIfDone`, `setSessionPartiallyFailed`, `tryReadErrReason`.
- Retains only: `processSession`, `stageFile`, `registerPending`, `transformFilename`.
- Calls `SseEventBroker.publish()` on every event append.
- Calls `SseEventBroker.complete()` on early-exit failures.

**`ReloadSessionService.java`**
- Added `cancelSession(sessionId)` — transitions non-terminal session to `cancelled`, appends `SESSION_CANCELLED` event, deletes pending files, calls `SseEventBroker.complete()`. Throws `SessionAlreadyTerminalException` (→ HTTP 409) for terminal sessions.
- Added `getSessionFiles(sessionId)` — returns `List<FileStatusDto>` from `ReloadPendingFileRepository`.
- `appendEvent()` now also calls `SseEventBroker.publish()`.

**`XfcsController.java`**
- Added `GET /api/xfcs/reload/{sessionId}/stream` — SSE endpoint (`text/event-stream`), accepts `?lastEventId=N`.
- Added `GET /api/xfcs/reload/{sessionId}/files` — returns `List<FileStatusDto>`.
- Added `POST /api/xfcs/reload/{sessionId}/cancel` — returns updated status or HTTP 409.
- `dashboard()` now uses count queries (no `findAll()`); returns `activeSessions`, `pendingFiles`, `stuckTimeoutMin`.

**`DashboardData.java`**
- Added fields: `activeSessions`, `pendingFiles`, `stuckTimeoutMin`.

**`XfcsProperties.java`**
- Added `stuckSessionTimeoutMin` (default `60`). Set to `0` to disable stuck-session detection.

**`ReloadSessionRepository.java`**
- Added `countByStatusNotIn(Collection<String> statuses)` for efficient active-session counting.

**`ReloadPendingFileEntity.java`**
- Added fields: `fileStatus`, `errorReason`, `resolvedAt` with getters/setters.

**`application.yml`**
- Added `xfcs.stuck-session-timeout-min: ${XFCS_STUCK_SESSION_TIMEOUT_MIN:60}`.

**`pom.xml`**
- Added `net.jqwik:jqwik:1.8.2` (test scope) for property-based testing.

---

## Frontend

### New Files

| File | Purpose |
|---|---|
| `api/sse.service.ts` | Angular service wrapping native `EventSource`. `connect(sessionId, lastEventId?)` returns `Observable<ReloadSessionEvent>`. Exponential back-off: 1→2→4→8→16→30 s cap, max 5 retries, then falls back to 10 s polling. `disconnect(sessionId)` closes the stream. |

### Modified Files

**`api/xfcs-models.ts`**
- `DashboardData` extended with `activeSessions`, `pendingFiles`, `stuckTimeoutMin`.
- Added `FileStatusItem` interface: `absPath`, `fileName`, `userLotId`, `fileStatus`, `errorReason`, `createdAt`, `resolvedAt`.

**`api/xfcs-api.service.ts`**
- Added `getSessionFiles(sessionId)` → `Observable<FileStatusItem[]>`.
- Added `cancelSession(sessionId)` → `Observable<ReloadStatus>`.
- Added `getStreamUrl(sessionId, lastEventId?)` → SSE URL string.

**`xfcs/xfcs.component.ts`**
- Removed `setInterval` polling (`AUTO_REFRESH_MS`, `refreshHandle`, `startAutoRefresh`, `stopAutoRefresh`).
- Persists `currentSessionId` to `localStorage` on session creation; restores on `ngOnInit`.
- On init with a saved session: fetches full event log to hydrate activity feed (deduplicating by `id`), then opens SSE stream.
- Drives `lastStatus` updates from SSE events; re-fetches status on terminal events.
- Passes `liveConnected` boolean to `XfcsSessionMonitorComponent`.
- Activity feed max increased from 50 → 200 events.

**`xfcs/xfcs-session-monitor.component.ts`**
- Removed internal `timer(0, 3000)` polling.
- Added `@Input() liveConnected: boolean` — shows pulsing green dot when `true`.
- Added "Cancel Session" button (visible when session is non-terminal); shows inline confirmation before calling `cancelSession()`.
- Added `cancelled` CSS state for the status label.
- `sessionCompleted` output now emits when parent passes a terminal `lastStatus` via `ngOnChanges`.

**`xfcs/xfcs-sessions.component.ts`**
- Expanded row now calls `getSessionFiles(sessionId)` and displays per-file status badges.
- Badge colors: `pending` (gray), `staging` (blue/accent), `completed` (green), `failed` (red).
- Shows `errorReason` inline under the file path when `fileStatus === 'failed'`.

**`xfcs/xfcs-stats.component.ts`**
- Added `Active Sessions` stat card with pulsing dot when value > 0.
- Added `Pending Files` stat card.
- Grid expanded from 4 → 6 columns.

**`package.json`**
- Added `fast-check: ^3.22.0` (devDependency) for property-based testing.

---

## Tests

### Backend (`src/test/java/...`)

| File | Type | Properties / Coverage |
|---|---|---|
| `SseEventBrokerTest.java` | Unit (JUnit 5 + Mockito) | subscribe returns emitter, replays events, publish/complete lifecycle |
| `SseReplayPropertyTest.java` | Property (jqwik) | **Property 2**: replay completeness for any N events and any lastEventId |
| `FileStatusStateMachinePropertyTest.java` | Property (jqwik) | **Property 4**: inbox-root→staging, Processed→completed, NotProcessed→failed for any path |
| `StuckSessionPropertyTest.java` | Property (jqwik) | **Property 5**: stuck session cleanup invariant for any timeout and pending file count |
| `CancelSessionPropertyTest.java` | Property (jqwik) | **Property 6**: cancel on terminal → 409; **Property 7**: cancel cleans up pending files |
| `ReloadPendingMonitorTest.java` | Unit (JUnit 5 + Mockito) | file status transitions, stuck-session detection, SSE broker calls |

### Frontend (`src/app/...`)

| File | Type | Properties / Coverage |
|---|---|---|
| `api/sse.service.spec.ts` | Property (fast-check + Jasmine) | **Property 3**: back-off sequence [1,2,4,8,16,30]s cap, fallback after 5 retries |
| `xfcs/activity-feed-dedup.spec.ts` | Property (fast-check + Jasmine) | **Property 8**: deduplication by id, idempotency, output length = unique input count |

---

## New API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/xfcs/reload/{sessionId}/stream` | SSE stream (`text/event-stream`). Accepts `?lastEventId=N`. |
| `GET` | `/api/xfcs/reload/{sessionId}/files` | Per-file status list (`List<FileStatusDto>`). |
| `POST` | `/api/xfcs/reload/{sessionId}/cancel` | Cancel session. Returns 409 if already terminal. |

---

## Configuration

| Property | Default | Description |
|---|---|---|
| `xfcs.stuck-session-timeout-min` | `60` | Minutes before a non-terminal session is auto-failed. Set to `0` to disable. |
| `xfcs.pending-monitor-interval-ms` | `5000` | Scan interval for `ReloadPendingMonitor`. |
