# Design Document: Reload Monitoring Overhaul

## Overview

The current reload monitoring feature relies on HTTP polling (3.5 s frontend, 5 s backend scanner), has duplicated monitoring logic across two classes, loses the activity feed on page refresh, and provides no per-file status granularity, no stuck-session safety net, and no cancellation capability. This design replaces polling with Server-Sent Events (SSE), consolidates backend monitoring into a single component, adds per-file lifecycle tracking, introduces stuck-session auto-timeout, persists the event log across page refreshes, and adds session cancellation — all while preserving the existing Angular + Spring Boot stack and database schema.

---

## Architecture

```mermaid
graph TD
    subgraph Frontend [Angular Frontend]
        XfcsComp[XfcsComponent]
        Monitor[XfcsSessionMonitorComponent]
        Sessions[XfcsSessionsComponent]
        Stats[XfcsStatsComponent]
        Feed[ActivityFeedComponent]
        SSESvc[SseService]
        ApiSvc[XfcsApiService]
    end

    subgraph Backend [Spring Boot Backend]
        Controller[XfcsController]
        SessionSvc[ReloadSessionService]
        ExecSvc[ReloadExecutionService]
        PendingMon[ReloadPendingMonitor]
        SseBroker[SseEventBroker]
        DB[(H2 / Oracle DB)]
    end

    XfcsComp --> SSESvc
    XfcsComp --> ApiSvc
    Monitor --> SSESvc
    Sessions --> ApiSvc
    Stats --> ApiSvc
    Feed --> SSESvc

    SSESvc -->|GET /reload/{id}/stream| Controller
    ApiSvc -->|REST calls| Controller

    Controller --> SessionSvc
    Controller --> SseBroker
    SessionSvc --> DB
    ExecSvc --> DB
    PendingMon --> DB
    PendingMon --> SseBroker
    SseBroker -->|push events| Controller
```

The key architectural change is the introduction of `SseEventBroker` — a Spring `@Component` that holds a `ConcurrentHashMap<sessionId, List<SseEmitter>>` and provides `publish(sessionId, event)` and `subscribe(sessionId)` methods. Every component that appends an event to the database also calls `SseEventBroker.publish()` so the event is pushed to all connected clients immediately.

---

## Components and Interfaces

### Backend

#### SseEventBroker (new)

```java
@Component
public class SseEventBroker {
    // sessionId → active emitters
    private final ConcurrentHashMap<String, CopyOnWriteArrayList<SseEmitter>> emitters;

    /** Called by controller to create a new SSE subscription. */
    public SseEmitter subscribe(String sessionId, Long lastEventId);

    /** Called by any service that appends an event. Pushes to all subscribers. */
    public void publish(String sessionId, ReloadSessionEvent event);

    /** Called when a session reaches terminal status. Closes all emitters. */
    public void complete(String sessionId);
}
```

- `subscribe()` creates a `SseEmitter` with a 5-minute timeout, registers it, and replays all events with `id > lastEventId` from the database before returning.
- `publish()` serializes the event as JSON and calls `emitter.send()` on each registered emitter, removing any that have timed out or errored.
- `complete()` sends a final `SESSION_TERMINAL` event then calls `emitter.complete()` on all emitters for the session.

#### ReloadPendingMonitor (consolidated — replaces duplicate logic)

All scanning logic from `ReloadExecutionService` is removed. `ReloadPendingMonitor` gains:

- `stuck-session-timeout-min` config property (default 60).
- `checkStuckSessions()` called at the end of each `scanPendingFiles()` cycle.
- Calls `SseEventBroker.publish()` after every event append.
- Calls `SseEventBroker.complete()` when a session is finalized.

#### ReloadExecutionService (simplified)

- Removes: `scanPendingFiles()`, `findFileWithCommand()`, `findFileInTree()`, `finalizeSessionIfDone()`, `setSessionPartiallyFailed()`, `tryReadErrReason()`.
- Retains: `processSession()` (staging only), `stageFile()`, `registerPending()`, `transformFilename()`.
- After staging, calls `SseEventBroker.publish()` for each `FILE_STAGED` / `FILE_COMPLETED` / `FILE_FAILED` event.

#### XfcsController (additions)

```
GET  /api/xfcs/reload/{sessionId}/stream   → SSE stream
GET  /api/xfcs/reload/{sessionId}/files    → List<FileStatusDto>
POST /api/xfcs/reload/{sessionId}/cancel   → ReloadSession (or 409)
```

#### New DTOs

```java
record FileStatusDto(
    String absPath,
    String fileName,
    String originalFileName,
    String userLotId,
    String fileStatus,   // pending | staging | completed | failed
    String errorReason,
    Instant createdAt,
    Instant resolvedAt
) {}

// DashboardData gains two new fields:
record DashboardData(
    String generatedAt,
    int totalRequests,
    int completed,
    int failed,
    List<String> recentLots,
    int activeSessions,   // NEW
    int pendingFiles,     // NEW
    int stuckTimeoutMin   // NEW
) {}
```

### Frontend

#### SseService (new Angular service)

```typescript
@Injectable({ providedIn: 'root' })
export class SseService {
  /** Opens an SSE stream; emits ReloadSessionEvent objects. */
  connect(sessionId: string, lastEventId?: number): Observable<ReloadSessionEvent>;

  /** Closes the stream for a session. */
  disconnect(sessionId: string): void;
}
```

- Uses the native `EventSource` API.
- On error, applies exponential back-off: 1 s → 2 s → 4 s → 8 s → 16 s → 30 s cap, max 5 retries, then falls back to 10 s polling.
- Passes `Last-Event-ID` header on reconnect via URL query param `?lastEventId=N` (since `EventSource` does not allow custom headers).

#### XfcsComponent (modified)

- Removes `setInterval` / `refreshHandle`.
- Subscribes to `SseService.connect(sessionId)` after creating a reload session.
- Persists `currentSessionId` to `localStorage` on creation; reads it back on `ngOnInit`.
- On init, if a `currentSessionId` is found in `localStorage`, fetches the full event log via `GET /reload/{id}/events` to hydrate the activity feed, then opens the SSE stream.

#### XfcsSessionMonitorComponent (modified)

- Removes internal polling (`timer(0, 3000)`).
- Accepts `lastStatus` as `@Input()` (already exists) — parent drives it via SSE events.
- Adds `@Input() liveConnected: boolean` to show/hide the live-connection indicator.
- Adds a "Cancel" button visible when `lastStatus.status` is non-terminal.

#### XfcsSessionsComponent (modified)

- Expanded row now calls `GET /api/xfcs/reload/{sessionId}/files` to load per-file status.
- Renders a status badge per file: `pending` (gray), `staging` (blue), `completed` (green), `failed` (red).
- Shows `errorReason` in a tooltip or inline when `fileStatus === 'failed'`.

#### XfcsStatsComponent (modified)

- Adds two new stat cards: `Active Sessions` (with pulse animation when > 0) and `Pending Files`.
- Reads `activeSessions`, `pendingFiles` from `DashboardData`.

---

## Data Models

### Schema Changes

#### `xfcs_dearchiver_reload_pending_files` — add columns

```sql
ALTER TABLE xfcs_dearchiver_reload_pending_files
  ADD file_status   VARCHAR(32)  DEFAULT 'pending' NOT NULL,
  ADD error_reason  VARCHAR(2000),
  ADD resolved_at   TIMESTAMP;
```

#### No changes to `xfcs_dearchiver_reload_sessions` or `xfcs_dearchiver_reload_session_events`.

### Updated Entity

```java
// ReloadPendingFileEntity additions
@Column(name = "file_status", length = 32, nullable = false)
private String fileStatus = "pending";   // pending | staging | completed | failed

@Column(name = "error_reason", length = 2000)
private String errorReason;

@Column(name = "resolved_at")
private Instant resolvedAt;
```

### Frontend Model Additions

```typescript
// xfcs-models.ts additions
export interface FileStatusItem {
  absPath: string;
  fileName: string;
  originalFileName?: string;
  userLotId?: string;
  fileStatus: 'pending' | 'staging' | 'completed' | 'failed';
  errorReason?: string;
  createdAt?: string;
  resolvedAt?: string;
}

// DashboardData additions
export interface DashboardData {
  generatedAt: string;
  totalRequests: number;
  completed: number;
  failed: number;
  recentLots: string[];
  activeSessions: number;   // new
  pendingFiles: number;     // new
  stuckTimeoutMin: number;  // new
}
```

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: SSE event delivery latency

*For any* session and any event appended to its Event_Log, the event should appear on all active SSE streams for that session within 500 ms of being written to the database.

**Validates: Requirements 1.2**

---

### Property 2: SSE Last-Event-ID replay completeness

*For any* session with N events (ids 1..N) and any reconnect with `lastEventId = k` where `0 ≤ k < N`, the replayed stream should contain exactly the events with ids `k+1` through `N` in ascending order, with no duplicates and no omissions.

**Validates: Requirements 1.4**

---

### Property 3: SSE reconnect back-off sequence

*For any* sequence of consecutive connection failures, the delay before each retry attempt should follow the sequence `[1, 2, 4, 8, 16, 30, 30, ...]` seconds (capped at 30 s), and after 5 consecutive failures the service should switch to 10 s polling.

**Validates: Requirements 1.6**

---

### Property 4: File status state machine correctness

*For any* pending file, after the monitor scans and locates it in a known directory, the `file_status` field should reflect the canonical mapping: inbox-root → `staging`, `Processed/` subtree → `completed`, `NotProcessed/` subtree → `failed`. No other transitions are valid.

**Validates: Requirements 2.2, 2.3, 2.4**

---

### Property 5: Stuck-session cleanup invariant

*For any* session that has been in a non-terminal state for longer than `stuckTimeoutMin` minutes with no pending-file resolution, after one scan cycle: the session status must be `failed`, `completedAt` must be set, a `SESSION_TIMED_OUT` event must exist in the Event_Log, and the count of pending files for that session must be 0.

**Validates: Requirements 3.1, 3.2, 3.3**

---

### Property 6: Cancel idempotency on terminal sessions

*For any* session already in a Terminal_Status (`completed`, `failed`, `partially_failed`, `cancelled`), calling `POST /cancel` should return HTTP 409 and leave the session status unchanged.

**Validates: Requirements 6.4**

---

### Property 7: Cancel cleans up pending files

*For any* non-terminal session with P pending files, after a successful cancel: the session status must be `cancelled`, a `SESSION_CANCELLED` event must exist, and the count of pending files for that session must be 0.

**Validates: Requirements 6.2**

---

### Property 8: Activity feed deduplication

*For any* list of events that contains duplicate `id` values, after merging into the Activity_Feed, each `id` should appear exactly once.

**Validates: Requirements 5.3**

---

## Error Handling

| Scenario | Backend Behavior | Frontend Behavior |
|---|---|---|
| SSE emitter timeout (5 min idle) | Emitter removed from broker map | SseService detects close, starts back-off reconnect |
| SSE publish to dead emitter | Catch `IOException`, remove emitter silently | N/A |
| Cancel on terminal session | Return HTTP 409 with `{ error: "SESSION_ALREADY_TERMINAL" }` | Toast warning: "Session is already in a terminal state" |
| Stuck session detected | Status → `failed`, `SESSION_TIMED_OUT` event, pending files removed | SSE pushes event; monitor panel shows failed state |
| File search timeout (find command > 10 s) | Log warning, skip file for this cycle | No UI change; file remains `staging` |
| DB unavailable during scan | Log error, skip entire scan cycle | SSE connection remains open; no false terminal events |
| `stuckTimeoutMin = 0` | Stuck-session check is skipped entirely | N/A |

---

## Testing Strategy

### Unit Tests (JUnit 5 + Mockito)

- `SseEventBrokerTest`: verify `subscribe()` replays correct events, `publish()` calls `send()` on all emitters, `complete()` sends terminal event and closes emitters.
- `ReloadPendingMonitorTest`: verify file-status transitions, stuck-session detection, session finalization logic.
- `ReloadExecutionServiceTest`: verify staging logic is unchanged, no monitoring methods remain.
- `XfcsControllerTest` (MockMvc): verify `/stream` returns `text/event-stream`, `/files` returns correct DTO, `/cancel` returns 409 on terminal sessions.
- `SseServiceTest` (Angular): verify back-off sequence, `lastEventId` query param, fallback to polling.
- `ActivityFeedDeduplicationTest` (Angular): verify deduplication by id.

### Property-Based Tests

Use **jqwik** (Java) for backend properties and **fast-check** (TypeScript) for frontend properties. Minimum 100 iterations per property.

- **Property 1** — `SseLatencyProperty`: generate random events, measure publish-to-receive time.
  - Tag: `Feature: reload-monitoring-overhaul, Property 1: SSE event delivery latency`
- **Property 2** — `SseReplayProperty`: generate sessions with random event counts, reconnect at random `lastEventId`, assert replay set.
  - Tag: `Feature: reload-monitoring-overhaul, Property 2: SSE Last-Event-ID replay completeness`
- **Property 3** — `BackoffSequenceProperty`: generate random failure counts (1–10), assert delay sequence matches cap formula.
  - Tag: `Feature: reload-monitoring-overhaul, Property 3: SSE reconnect back-off sequence`
- **Property 4** — `FileStatusTransitionProperty`: generate random file paths and directory locations, assert status mapping.
  - Tag: `Feature: reload-monitoring-overhaul, Property 4: File status state machine correctness`
- **Property 5** — `StuckSessionProperty`: generate sessions with random ages exceeding timeout, run one scan cycle, assert invariants.
  - Tag: `Feature: reload-monitoring-overhaul, Property 5: Stuck-session cleanup invariant`
- **Property 6** — `CancelTerminalProperty`: generate sessions in each terminal status, call cancel, assert 409.
  - Tag: `Feature: reload-monitoring-overhaul, Property 6: Cancel idempotency on terminal sessions`
- **Property 7** — `CancelCleanupProperty`: generate non-terminal sessions with random pending file counts, cancel, assert cleanup.
  - Tag: `Feature: reload-monitoring-overhaul, Property 7: Cancel cleans up pending files`
- **Property 8** — `FeedDeduplicationProperty`: generate event lists with random duplicate ids, merge, assert uniqueness.
  - Tag: `Feature: reload-monitoring-overhaul, Property 8: Activity feed deduplication`
