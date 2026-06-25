# Requirements Document

## Introduction

This feature refactors the Exensio confirmation step in `ReloadPendingMonitor` to fire a single batch Exensio API call per session, but only after **all** files in that session have finished ETL pre-processing (either moved to `Processed/`, `NotProcessed/`, or `ReworkFiles/`). It also improves the monitoring view so the frontend shows per-file `etl_complete` status in real time while the session waits for Exensio confirmation.

The current implementation fires the Exensio batch lookup on every monitor scan cycle, accumulating whatever `exensio_loading` files happen to exist at that moment. This causes multiple partial batch calls for the same session and makes it harder to reason about session completion.

## Glossary

- **Session**: A `ReloadSessionEntity` representing one user-triggered reload request, identified by `session_id`
- **ETL pre-processing**: The phase where a file is moved by the ETL service from the inbox root to `Processed/`, `NotProcessed/`, or `ReworkFiles/`
- **etl_complete**: The new intermediate `file_status` value assigned to a file once ETL moves it to `Processed/` and Exensio is enabled — replacing the current `exensio_loading` value
- **exensio_loading** (deprecated): The old status label; replaced by `etl_complete` so status names match UI expectations
- **Session ETL fence**: The condition where every pending file in a session has transitioned out of `pending`/`staging` state — meaning all have reached `etl_complete`, `failed`, or equivalent terminal states
- **Exensio batch trigger**: The single call to `ExensioClient.lotWaferLookupBatch()` fired per session once the session ETL fence is crossed
- **Monitoring UI**: The `XfcsFileMonitorComponent` that shows per-file status in a table
- **ExensioClient**: The `@Service` that calls `POST /v1/key/lot-wafer-lookup` (REST, not raw SQL) against the Exensio API
- **Staging persistence table**: The `xfcs_dearchiver_reload_pending_files` table that tracks every file from discovery through terminal state, used for resumability across restarts

---

## Requirements

### Requirement 1: Rename `exensio_loading` to `etl_complete`

**User Story:** As a developer, I want a clear, consistent status name for files that have finished ETL but are awaiting Exensio confirmation, so that the status progression is self-documenting and aligns with the UI labels.

#### Acceptance Criteria

1. THE System SHALL use the file status value `"etl_complete"` (not `"exensio_loading"`) for files that have been moved by ETL to `Processed/` and are awaiting Exensio confirmation
2. WHEN the monitor reads existing rows with `file_status = 'exensio_loading'` from the staging persistence table on restart, THE System SHALL treat them identically to `etl_complete` rows (backward compatibility)
3. THE `ReloadPendingFileEntity` documentation SHALL reflect the updated status lifecycle: `pending → staging → etl_complete → completed | unverified-exensio`

---

### Requirement 2: Session ETL fence detection

**User Story:** As a system operator, I want the monitor to detect when all files in a session have cleared ETL pre-processing, so that the Exensio batch lookup fires exactly once per session at the right time.

#### Acceptance Criteria

1. WHEN `scanPendingFiles()` processes a session's files, THE ReloadPendingMonitor SHALL determine whether the session ETL fence has been crossed: all files belonging to the session are no longer in `pending` or `staging` status (they are in `etl_complete`, `failed`, `unverified-exensio`, or another terminal state)
2. WHEN a session has no pending files remaining (the staging table contains zero rows for that session), THE ReloadPendingMonitor SHALL NOT trigger an Exensio batch lookup for it (session is already terminal or has no ETL-complete files)
3. WHEN the ETL fence is crossed for a session, THE ReloadPendingMonitor SHALL immediately trigger the Exensio batch lookup for that session rather than waiting for the next scan cycle

---

### Requirement 3: One batch Exensio lookup per session

**User Story:** As a system operator, I want the Exensio confirmation check to happen in one batch per session, so that API calls are minimal and the session reaches a clean terminal state in a single pass.

#### Acceptance Criteria

1. WHEN the session ETL fence is crossed, THE ReloadPendingMonitor SHALL collect all files for that session with status `etl_complete` and call `ExensioClient.lotWaferLookupBatch()` once with all of them
2. THE ExensioClient SHALL continue to group records by Exensio schema (PRODUCTION/SANDBOX) within that single call and make one HTTP request per schema
3. WHEN the Exensio batch result is received, THE ReloadPendingMonitor SHALL update each file's status (`completed`, `unverified-exensio`, etc.) and trigger session finalization in the same transaction
4. IF Exensio is disabled (`exensioProperties.isEnabled() == false`), THE ReloadPendingMonitor SHALL skip the batch trigger entirely and mark files `completed` immediately when ETL finishes, as it does today

---

### Requirement 4: Resumability across restarts

**User Story:** As a system operator, I want sessions that were interrupted mid-flight (backend restart, DB blip, network outage) to resume correctly, so that no session is silently stuck in a non-terminal state.

#### Acceptance Criteria

1. WHEN the backend starts and `cleanupOrphanedPendingFiles()` runs, THE ReloadPendingMonitor SHALL identify sessions where all files are in `etl_complete` state (ETL fence already crossed before the restart) and re-trigger the Exensio batch lookup for those sessions
2. WHEN the backend starts and there are files in `pending` or `staging` state belonging to a non-terminal session, THE ReloadPendingMonitor SHALL resume scanning them normally on the next scan cycle — no data loss
3. THE staging persistence table SHALL remain the source of truth for resuming any in-flight session; no in-memory state is required across restarts

---

### Requirement 5: Real-time per-file status in monitoring UI

**User Story:** As a user, I want to see each file's status update to "ETL Complete – awaiting Exensio" as soon as ETL finishes, before the batch Exensio check fires, so that I can tell the process is progressing.

#### Acceptance Criteria

1. WHEN a file transitions to `etl_complete` status, THE ReloadPendingMonitor SHALL publish a `file_etl_completed` SSE event so the frontend receives the update in real time
2. WHEN the monitoring UI receives a `FileStatusItem` with `fileStatus === 'etl_complete'`, THE UI SHALL display the status as `"ETL Complete – awaiting Exensio"` (or equivalent label) in the file row
3. WHEN the monitoring UI receives a `FileStatusItem` with `fileStatus === 'completed'` after Exensio confirms the file, THE UI SHALL display `"Completed [PRODUCTION]"` or `"Completed [SANDBOX]"` as appropriate
4. THE `FileStatusItem` interface SHALL include `etl_complete` as a valid `fileStatus` value

---

### Requirement 6: Monitoring view shows per-file timing

**User Story:** As a user, I want to see when each file was staged and when it finished, so that I can diagnose slow ETL jobs.

#### Acceptance Criteria

1. WHEN a `FileStatusItem` has a `createdAt` timestamp, THE monitoring UI SHALL display it as the "Staged" time in the file row
2. WHEN a `FileStatusItem` has a `resolvedAt` timestamp, THE monitoring UI SHALL display it as the "Finished" time in the file row
3. THE `FileStatusItem` interface SHALL expose `createdAt` and `resolvedAt` as optional ISO-8601 string fields (they already exist in the staging table; this requires surfacing them in the DTO and the API response)

