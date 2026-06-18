# Requirements Document

## Introduction

The XFCS Reloader currently monitors reload sessions through HTTP polling (every 3.5 s on the frontend, every 5 s on the backend pending-file scanner). This creates unnecessary server load, introduces latency in status updates, and leaves several operational gaps: no per-file progress granularity, no stuck-session timeout, no retry capability, duplicated monitoring logic between `ReloadExecutionService` and `ReloadPendingMonitor`, and an activity feed that is lost on page refresh. This spec defines the requirements for an industry-standard overhaul of the reload monitoring feature that replaces polling with Server-Sent Events (SSE), adds per-file status tracking, introduces stuck-session detection and auto-timeout, consolidates backend monitoring logic, and persists the event log so the UI survives a page refresh.

## Glossary

- **Session**: A single reload job identified by a UUID, containing one or more files to be staged and processed by the ETL pipeline.
- **Pending File**: A file that has been staged to the environment inbox and is awaiting ETL pickup (Processed/ or NotProcessed/).
- **ETL**: The downstream Extract-Transform-Load pipeline that consumes files from the inbox and moves them to `Processed/` (success) or `NotProcessed/` (failure).
- **SSE**: Server-Sent Events — a unidirectional HTTP/1.1 streaming protocol where the server pushes events to the client over a persistent connection.
- **Session_Monitor**: The backend component responsible for scanning pending files and finalizing sessions.
- **Event_Log**: The ordered list of `ReloadSessionEvent` records for a session, stored in `xfcs_dearchiver_reload_session_events`.
- **Activity_Feed**: The frontend component that renders the Event_Log in real time.
- **Stuck_Session**: A session that has been in a non-terminal state for longer than the configured timeout threshold without any pending-file resolution.
- **Terminal_Status**: One of `completed`, `failed`, or `partially_failed`.
- **File_Status**: The per-file lifecycle state: `pending` → `staging` → `completed` | `failed`.

---

## Requirements

### Requirement 1: Replace Polling with Server-Sent Events

**User Story:** As an operator, I want the session monitor to update in real time without the browser hammering the server with repeated HTTP requests, so that I see status changes immediately and the server is not overloaded.

#### Acceptance Criteria

1. THE Backend SHALL expose a `GET /api/xfcs/reload/{sessionId}/stream` SSE endpoint that emits `ReloadSessionEvent` objects as they are appended to the Event_Log.
2. WHEN a new event is appended to the Event_Log for a session, THE Backend SHALL push that event to all active SSE subscribers for that session within 500 ms.
3. WHEN a session reaches a Terminal_Status, THE Backend SHALL emit a final `SESSION_TERMINAL` SSE event and close the stream.
4. WHEN an SSE client reconnects with a `Last-Event-ID` header, THE Backend SHALL replay all events with an id greater than the supplied value before resuming live streaming.
5. THE Frontend SHALL replace the `setInterval`-based polling in `XfcsComponent` and `XfcsSessionMonitorComponent` with an SSE subscription to the stream endpoint.
6. WHEN the SSE connection drops, THE Frontend SHALL attempt reconnection with exponential back-off (initial 1 s, max 30 s, up to 5 retries) before falling back to a 10 s polling interval.
7. WHILE a session is in a non-terminal state, THE Frontend SHALL display a live-connection indicator in the Session Monitor panel.

---

### Requirement 2: Per-File Status Tracking

**User Story:** As an operator, I want to see the status of each individual file in a reload session, so that I can quickly identify which files succeeded or failed without reading through a raw event log.

#### Acceptance Criteria

1. THE Backend SHALL maintain a `file_status` field on each `ReloadPendingFileEntity` with values: `pending`, `staging`, `completed`, `failed`.
2. WHEN a file is moved to the inbox root, THE Session_Monitor SHALL set its `file_status` to `staging`.
3. WHEN a file is found under `Processed/`, THE Session_Monitor SHALL set its `file_status` to `completed`.
4. WHEN a file is found under `NotProcessed/`, THE Session_Monitor SHALL set its `file_status` to `failed`.
5. THE Backend SHALL expose a `GET /api/xfcs/reload/{sessionId}/files` endpoint that returns the current `file_status`, `fileName`, `userLotId`, and `errorReason` for every file in the session.
6. WHEN the session detail row is expanded in the Sessions Table, THE Frontend SHALL display per-file status badges (pending / staging / completed / failed) alongside each file path and lot ID.
7. WHEN a file transitions to `failed`, THE Frontend SHALL display the `errorReason` (from the `.err` sibling file) in the expanded file row.

---

### Requirement 3: Stuck-Session Detection and Auto-Timeout

**User Story:** As an operator, I want sessions that have been stuck in a non-terminal state for too long to be automatically marked as failed, so that the pending-file table does not grow unbounded and operators are alerted.

#### Acceptance Criteria

1. THE Session_Monitor SHALL check, on every scan cycle, whether any non-terminal session has had no pending-file resolution for longer than `xfcs.stuck-session-timeout-min` minutes (default: 60).
2. WHEN a session is detected as a Stuck_Session, THE Session_Monitor SHALL set the session status to `failed`, set `completedAt` to the current time, and append a `SESSION_TIMED_OUT` event with a descriptive message.
3. WHEN a session is timed out, THE Session_Monitor SHALL remove all remaining pending-file entries for that session from the `xfcs_dearchiver_reload_pending_files` table.
4. IF `xfcs.stuck-session-timeout-min` is set to `0`, THEN THE Session_Monitor SHALL disable the stuck-session timeout entirely.
5. THE Backend SHALL expose the `stuck-session-timeout-min` value in the `/api/xfcs/dashboard` response so the frontend can display it.

---

### Requirement 4: Consolidate Backend Monitoring Logic

**User Story:** As a developer, I want the pending-file scanning logic to exist in exactly one place, so that bug fixes and improvements do not need to be applied twice.

#### Acceptance Criteria

1. THE `ReloadExecutionService` SHALL NOT contain any scheduled scanning, `findFileWithCommand`, `findFileInTree`, `finalizeSessionIfDone`, `setSessionPartiallyFailed`, or `tryReadErrReason` methods.
2. THE `ReloadPendingMonitor` SHALL be the single authoritative component for all pending-file scanning, session finalization, and stuck-session detection.
3. WHEN `ReloadExecutionService.processSession` completes staging, THE `ReloadExecutionService` SHALL delegate all subsequent monitoring to `ReloadPendingMonitor` by writing pending-file records to the database only.
4. THE `ReloadPendingMonitor` SHALL expose a `scanPendingFiles()` method that is the sole entry point for the scheduled scan.

---

### Requirement 5: Persistent Event Log and Activity Feed

**User Story:** As an operator, I want the activity feed to survive a page refresh and show the full history of a session, so that I do not lose context when I navigate away and return.

#### Acceptance Criteria

1. WHEN the frontend loads or navigates to the XFCS page, THE Frontend SHALL fetch the full Event_Log for the current session (if one exists in local storage) via `GET /api/xfcs/reload/{sessionId}/events` and populate the Activity_Feed.
2. THE Frontend SHALL persist the `currentSessionId` to browser `localStorage` so it survives a page refresh.
3. WHEN the Activity_Feed is populated from the persisted Event_Log, THE Frontend SHALL deduplicate events by `id` before rendering.
4. THE Frontend SHALL display a timestamp, event type badge, actor, and message for each event in the Activity_Feed.
5. WHEN the Activity_Feed contains more than 200 events, THE Frontend SHALL paginate or virtualize the list to avoid DOM performance degradation.

---

### Requirement 6: Session Cancellation

**User Story:** As an operator, I want to cancel a session that is still in the `processing` state, so that I can stop a mistaken or stuck reload without waiting for the timeout.

#### Acceptance Criteria

1. THE Backend SHALL expose a `POST /api/xfcs/reload/{sessionId}/cancel` endpoint that transitions a non-terminal session to `cancelled` status.
2. WHEN a session is cancelled, THE Backend SHALL append a `SESSION_CANCELLED` event and remove all pending-file entries for that session.
3. WHEN a session is cancelled, THE Backend SHALL NOT attempt to delete or move files that have already been staged to the inbox.
4. IF the session is already in a Terminal_Status, THEN THE Backend SHALL return HTTP 409 Conflict.
5. THE Frontend SHALL display a "Cancel" button in the Session Monitor panel when the session is in a non-terminal, non-cancelled state.
6. WHEN the cancel button is clicked, THE Frontend SHALL prompt the user for confirmation before sending the cancel request.

---

### Requirement 7: Dashboard Enhancements

**User Story:** As an operator, I want the dashboard to show currently active sessions and pending-file counts, so that I have an at-a-glance operational view.

#### Acceptance Criteria

1. THE Backend SHALL include `activeSessions` (count of sessions in non-terminal status) and `pendingFiles` (count of rows in `xfcs_dearchiver_reload_pending_files`) in the `DashboardData` response.
2. THE Frontend Stats component SHALL display `activeSessions` and `pendingFiles` as additional stat cards.
3. WHEN `activeSessions` is greater than 0, THE Frontend SHALL display the active-sessions stat card with a pulsing indicator.
4. THE Backend SHALL compute `DashboardData` in a single database query pass to avoid N+1 queries.
