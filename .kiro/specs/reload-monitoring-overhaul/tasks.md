# Implementation Plan: Reload Monitoring Overhaul

## Overview

Incremental implementation that builds the SSE infrastructure first, then consolidates backend monitoring, adds per-file tracking, stuck-session timeout, session cancellation, frontend SSE integration, and finally dashboard enhancements. Each step is independently testable.

---

## Tasks

- [x] 1. Database schema migration and entity updates
  - Add a new Liquibase changeset `db.changelog-5.6-pending-files-status.xml` that adds `file_status VARCHAR(32) DEFAULT 'pending' NOT NULL`, `error_reason VARCHAR(2000)`, and `resolved_at TIMESTAMP` columns to `xfcs_dearchiver_reload_pending_files`.
  - Register the new changeset in `db.changelog-master.xml`.
  - Update `ReloadPendingFileEntity` with the three new fields and getters/setters.
  - Add `FileStatusDto` record to the `web/dto` package with fields: `absPath`, `fileName`, `originalFileName`, `userLotId`, `fileStatus`, `errorReason`, `createdAt`, `resolvedAt`.
  - _Requirements: 2.1, 2.5_

- [x] 2. Implement SseEventBroker
  - [x] 2.1 Create `SseEventBroker` Spring `@Component` in the `service` package.
    - Hold a `ConcurrentHashMap<String, CopyOnWriteArrayList<SseEmitter>>` keyed by sessionId.
    - Implement `subscribe(sessionId, lastEventId)`: creates a `SseEmitter` with 5-minute timeout, replays all events with `id > lastEventId` from `ReloadSessionEventRepository`, registers the emitter, and returns it.
    - Implement `publish(sessionId, ReloadSessionEvent)`: serializes the event to JSON and calls `emitter.send()` on each registered emitter, removing any that have timed out or errored.
    - Implement `complete(sessionId)`: sends a final `SESSION_TERMINAL` SSE event, calls `emitter.complete()` on all emitters for the session, and removes the session entry from the map.
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [x] 2.2 Write property test for SSE Last-Event-ID replay completeness
    - **Property 2: SSE Last-Event-ID replay completeness**
    - **Validates: Requirements 1.4**

  - [x] 2.3 Write unit tests for SseEventBroker
    - Test `subscribe()` replays correct events when `lastEventId` is provided.
    - Test `publish()` calls `send()` on all registered emitters.
    - Test `complete()` sends the terminal event and closes all emitters.
    - _Requirements: 1.1, 1.2, 1.3_

- [x] 3. Add SSE endpoint to XfcsController
  - Inject `SseEventBroker` into `XfcsController`.
  - Add `GET /api/xfcs/reload/{sessionId}/stream` endpoint that calls `SseEventBroker.subscribe(sessionId, lastEventId)` and returns the `SseEmitter`.
  - Accept optional `lastEventId` query param (`Long`, defaults to `0`).
  - Set response content-type to `text/event-stream`.
  - _Requirements: 1.1, 1.4_

- [x] 4. Consolidate backend monitoring into ReloadPendingMonitor
  - [x] 4.1 Remove duplicate monitoring methods from `ReloadExecutionService`.
    - Delete: `scanPendingFiles()`, `findFileWithCommand()`, `findFileInTree()`, `finalizeSessionIfDone()`, `setSessionPartiallyFailed()`, `tryReadErrReason()`, and the `@Scheduled` annotation on `scanPendingFiles`.
    - Verify `ReloadExecutionService` retains only: `processSession()`, `stageFile()`, `registerPending()`, `transformFilename()`, and `appendEvent()`.
    - _Requirements: 4.1, 4.3_

  - [x] 4.2 Wire `SseEventBroker` into `ReloadPendingMonitor` and `ReloadExecutionService`.
    - Inject `SseEventBroker` into both classes.
    - Every `appendEvent()` call in both classes must also call `SseEventBroker.publish(sessionId, event)`.
    - `finalizeSessionIfDone()` in `ReloadPendingMonitor` must call `SseEventBroker.complete(sessionId)` after finalizing.
    - _Requirements: 1.2, 4.2, 4.4_

  - [x] 4.3 Write unit tests for consolidated ReloadPendingMonitor
    - Test file-status transitions (staging → completed, staging → failed).
    - Test session finalization calls `SseEventBroker.complete()`.
    - Test `SseEventBroker.publish()` is called on every event append.
    - _Requirements: 4.2, 4.4_

- [x] 5. Per-file status tracking
  - [x] 5.1 Update `ReloadPendingMonitor.scanPendingFiles()` to set `file_status` on each `ReloadPendingFileEntity`.
    - Set `file_status = 'staging'` when the file is found at the inbox-root path (same as `absPath`).
    - Set `file_status = 'completed'` and `resolvedAt = Instant.now()` when found under `Processed/`.
    - Set `file_status = 'failed'`, populate `errorReason` from the `.err` sibling file, and set `resolvedAt = Instant.now()` when found under `NotProcessed/`.
    - Save the entity after each status change.
    - _Requirements: 2.2, 2.3, 2.4_

  - [x] 5.2 Add `GET /api/xfcs/reload/{sessionId}/files` endpoint to `XfcsController`.
    - Query `ReloadPendingFileRepository.findBySessionId(sessionId)` to build `List<FileStatusDto>`.
    - Map each `ReloadPendingFileEntity` to a `FileStatusDto`.
    - _Requirements: 2.5_

  - [x] 5.3 Write property test for file status state machine correctness
    - **Property 4: File status state machine correctness**
    - **Validates: Requirements 2.2, 2.3, 2.4**

- [ ] 6. Checkpoint — Ensure all backend tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Stuck-session detection and auto-timeout
  - [x] 7.1 Add `stuckSessionTimeoutMin` property (default `60`) to `XfcsProperties` with getter/setter.
    - Add `xfcs.stuck-session-timeout-min=60` to `application.yml`.
    - _Requirements: 3.1, 3.4_

  - [x] 7.2 Implement `checkStuckSessions()` in `ReloadPendingMonitor`, called at the end of each `scanPendingFiles()` cycle.
    - Query all non-terminal sessions (status not in `completed`, `failed`, `partially_failed`, `cancelled`).
    - For each session where `createdAt < now - stuckTimeoutMin` minutes: set status to `failed`, set `completedAt = Instant.now()`, append a `SESSION_TIMED_OUT` event with a descriptive message, delete all pending-file entries for that session, and call `SseEventBroker.complete(sessionId)`.
    - Skip the entire check if `stuckTimeoutMin == 0`.
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 7.3 Write property test for stuck-session cleanup invariant
    - **Property 5: Stuck-session cleanup invariant**
    - **Validates: Requirements 3.1, 3.2, 3.3**

- [x] 8. Session cancellation
  - [x] 8.1 Add `cancelSession(sessionId)` method to `ReloadSessionService`.
    - If the session is already in a Terminal_Status (`completed`, `failed`, `partially_failed`, `cancelled`), throw a new `SessionAlreadyTerminalException` (map to HTTP 409 in the controller).
    - Otherwise: set status to `cancelled`, set `completedAt = Instant.now()`, append a `SESSION_CANCELLED` event, delete all pending-file entries for that session, and call `SseEventBroker.complete(sessionId)`.
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [x] 8.2 Add `POST /api/xfcs/reload/{sessionId}/cancel` endpoint to `XfcsController`.
    - Call `reloadSessionService.cancelSession(sessionId)` and return the updated `ReloadStatus`.
    - Map `SessionAlreadyTerminalException` to HTTP 409 with body `{ "error": "SESSION_ALREADY_TERMINAL" }`.
    - _Requirements: 6.1, 6.4_

  - [x] 8.3 Write property test for cancel idempotency on terminal sessions
    - **Property 6: Cancel idempotency on terminal sessions**
    - **Validates: Requirements 6.4**

  - [x] 8.4 Write property test for cancel cleanup
    - **Property 7: Cancel cleans up pending files**
    - **Validates: Requirements 6.2**

- [x] 9. Dashboard enhancements (backend)
  - Update `DashboardData` record to add three new fields: `activeSessions` (int), `pendingFiles` (int), `stuckTimeoutMin` (int).
  - Update `XfcsController.dashboard()` to compute `activeSessions` via `reloadSessionRepository.countByStatusNotIn(terminalStatuses)` and `pendingFiles` via `pendingFileRepository.count()` — avoid `findAll()`.
  - Add the required count query methods to `ReloadSessionRepository` and `ReloadPendingFileRepository` if not already present.
  - Expose `xfcsProperties.getStuckSessionTimeoutMin()` as `stuckTimeoutMin` in the response.
  - _Requirements: 7.1, 7.4, 3.5_

- [ ] 10. Checkpoint — Ensure all backend tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Frontend: SseService
  - [x] 11.1 Create `SseService` Angular service (`src/app/api/sse.service.ts`) using the native `EventSource` API.
    - `connect(sessionId: string, lastEventId?: number): Observable<ReloadSessionEvent>` — opens an `EventSource` to `/api/xfcs/reload/{sessionId}/stream?lastEventId=N`, emits parsed `ReloadSessionEvent` objects.
    - On `EventSource` error: apply exponential back-off delays `[1, 2, 4, 8, 16, 30]` seconds (capped at 30 s), max 5 retries, then fall back to 10 s polling via `XfcsApiService.getReloadEvents()`.
    - `disconnect(sessionId: string)`: closes the `EventSource` for that session.
    - _Requirements: 1.5, 1.6_

  - [x] 11.2 Write property test for SSE reconnect back-off sequence
    - **Property 3: SSE reconnect back-off sequence**
    - **Validates: Requirements 1.6**

- [x] 12. Frontend: XfcsApiService additions
  - Add `getSessionFiles(sessionId: string): Observable<FileStatusItem[]>` calling `GET /api/xfcs/reload/{sessionId}/files`.
  - Add `cancelSession(sessionId: string): Observable<ReloadStatus>` calling `POST /api/xfcs/reload/{sessionId}/cancel`.
  - Add `FileStatusItem` interface to `xfcs-models.ts` with fields: `absPath`, `fileName`, `originalFileName?`, `userLotId?`, `fileStatus: 'pending' | 'staging' | 'completed' | 'failed'`, `errorReason?`, `createdAt?`, `resolvedAt?`.
  - Update `DashboardData` interface in `xfcs-models.ts` to add `activeSessions: number`, `pendingFiles: number`, `stuckTimeoutMin: number`.
  - _Requirements: 2.5, 6.1, 7.2_

- [x] 13. Frontend: XfcsComponent SSE integration
  - Remove `setInterval` / `refreshHandle` / `startAutoRefresh` / `stopAutoRefresh` and the `AUTO_REFRESH_MS` constant.
  - On reload session creation: persist `currentSessionId` to `localStorage`, subscribe to `SseService.connect(sessionId)`.
  - On `ngOnInit`: read `currentSessionId` from `localStorage`; if present, call `getReloadEvents()` to hydrate the activity feed (deduplicating by `id`), then open the SSE stream.
  - Drive `lastStatus` updates from SSE `SESSION_*` events by re-fetching status on each terminal event via `getReloadStatus()`.
  - Pass `liveConnected` boolean to `XfcsSessionMonitorComponent` (true while SSE stream is open and session is non-terminal).
  - Unsubscribe from SSE on `ngOnDestroy`.
  - _Requirements: 1.5, 5.1, 5.2_

- [x] 14. Frontend: XfcsSessionMonitorComponent updates
  - Remove internal `timer(0, 3000)` polling (`startPolling()`, `stopPolling()`, `pollingActive` flag, `destroy$` Subject).
  - Add `@Input() liveConnected: boolean` — show a pulsing green dot in the panel header when `true`.
  - Add a "Cancel" button visible when `lastStatus.status` is non-terminal and not `cancelled`; on click, show a confirmation dialog (Angular Material `MatDialog`) then call `XfcsApiService.cancelSession(sessionId)`.
  - Emit `sessionCompleted` output when the parent passes a terminal `lastStatus`.
  - _Requirements: 1.7, 6.5, 6.6_

- [x] 15. Frontend: XfcsSessionsComponent per-file status
  - When a row is expanded, call `XfcsApiService.getSessionFiles(sessionId)` and store the result in a local signal/map keyed by sessionId.
  - Display per-file status badges alongside each file path and lot ID: `pending` (gray), `staging` (blue/accent), `completed` (green), `failed` (red).
  - Show `errorReason` inline under the file path when `fileStatus === 'failed'`.
  - _Requirements: 2.6, 2.7_

- [x] 16. Frontend: Activity feed persistence and deduplication
  - [x] 16.1 Update `XfcsComponent` to deduplicate events by `id` before adding to `activityEvents` (use the existing `seenEventIds` Set, but also apply it when hydrating from the persisted event log on init).
    - _Requirements: 5.3_

  - [x] 16.2 Increase activity feed max from 50 to 200; add Angular CDK `cdk-virtual-scroll-viewport` when the event count exceeds 200.
    - _Requirements: 5.4, 5.5_

  - [x] 16.3 Write property test for activity feed deduplication
    - **Property 8: Activity feed deduplication**
    - **Validates: Requirements 5.3**

- [x] 17. Frontend: XfcsStatsComponent dashboard enhancements
  - Add `activeSessions` stat card with a pulsing CSS indicator when `activeSessions > 0`.
  - Add `pendingFiles` stat card.
  - Update the `statCards` getter to read `activeSessions` and `pendingFiles` from `DashboardData`.
  - Update the grid to accommodate 6 cards (adjust `grid-template-columns`).
  - _Requirements: 7.2, 7.3_

- [ ] 18. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

---

## Notes

- All tasks are required, including tests.
- Each task references specific requirements for traceability.
- Checkpoints ensure incremental validation.
- Property tests use **jqwik** (Java backend) and **fast-check** (TypeScript frontend).
- Unit tests use JUnit 5 + Mockito (backend) and Jest (frontend).
- No backend test directory exists yet — create `src/test/java/...` alongside the first test task.
