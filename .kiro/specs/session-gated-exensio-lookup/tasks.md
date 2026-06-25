# Implementation Plan: Session-Gated Exensio Lookup

## Overview

Refactor `ReloadPendingMonitor` to fire one Exensio batch call per session after all ETL
pre-processing completes, rename the intermediate status from `exensio_loading` to
`etl_complete`, add resume-on-restart logic, and surface per-file timing in the monitoring UI.

---

## Tasks

- [x] 1. Add Liquibase migration and repository method for etl_complete status
  - [x] 1.1 Create Liquibase changeset to rename exensio_loading rows to etl_complete
    - Add `db.changelog-7.1-rename-exensio-loading.xml` under `backend/src/main/resources/db/changelog/`
    - UPDATE `xfcs_dearchiver_reload_pending_files` SET `file_status = 'etl_complete'` WHERE `file_status = 'exensio_loading'`
    - Register in `db.changelog-master.xml`
    - _Requirements: 1.1_

  - [x] 1.2 Add `findBySessionIdAndFileStatusIn` to `ReloadPendingFileRepository`
    - Add: `List<ReloadPendingFileEntity> findBySessionIdAndFileStatusIn(String sessionId, Collection<String> statuses)`
    - This is used to fetch all `etl_complete` + `exensio_loading` files for a session in one query
    - _Requirements: 3.1_

- [x] 2. Implement `isEtlFenceCrossed` and extract `triggerExensioForSession`
  - [x] 2.1 Add static `isEtlFenceCrossed(List<ReloadPendingFileEntity>)` to `ReloadPendingMonitor`
    - Returns `false` for null/empty list
    - Returns `true` iff no file has `fileStatus` of `"pending"` or `"staging"`
    - Add `ETL_COMPLETE_STATUSES = Set.of("etl_complete", "exensio_loading")` constant for backward compat
    - _Requirements: 1.2, 2.1, 2.2_

  - [ ]* 2.2 Write property test for isEtlFenceCrossed
    - **Property 1: ETL fence predicate correctness**
    - **Property 2: backward-compatible status treatment**
    - **Validates: Requirements 2.1, 2.2, 1.2**

  - [x] 2.3 Extract `triggerExensioForSession(String sessionId, List<ReloadPendingFileEntity> etlCompleteFiles, Set<String> sessionsToFinalize)` from current `processExensioLoading()`
    - Receives only files for ONE session (not all sessions)
    - Internal logic for DONE/NOT_FOUND/ERROR handling is unchanged from current `processExensioLoading()`
    - After processing: delete resolved rows, add sessionId to `sessionsToFinalize`
    - _Requirements: 3.1, 3.3_

  - [ ]* 2.4 Write property test for triggerExensioForSession
    - **Property 3: one batch call per session when fence is crossed**
    - **Property 4: exensio-disabled path marks files completed immediately**
    - **Validates: Requirements 3.1, 3.4**

- [x] 3. Refactor scanPendingFiles() trigger logic
  - [x] 3.1 Replace the current `processExensioLoading` call in `scanPendingFiles()` with per-session fence check
    - Change file status written on Processed/ detection from `"exensio_loading"` to `"etl_complete"`
    - After all files processed in the scan loop: group remaining pending files by `sessionId`
    - For each session group: call `isEtlFenceCrossed(sessionFiles)`; if true and etlComplete list non-empty → `triggerExensioForSession()`; if true but no etlComplete → add to `sessionsToFinalize` directly
    - If Exensio disabled: promote etl_complete files directly to completed (as today), add to `toRemove` and `sessionsToFinalize`
    - Remove the old `findByFileStatus("exensio_loading")` call
    - _Requirements: 1.1, 2.3, 3.1, 3.4_

  - [ ]* 3.2 Write property test for SSE event on etl_complete transition
    - **Property 5: SSE event published on etl_complete transition**
    - **Validates: Requirements 5.1**

  - [x] 3.3 Checkpoint — run backend tests; ensure all pass
    - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Add resume-on-restart for sessions with etl_complete files
  - [x] 4.1 Extend `cleanupOrphanedPendingFiles()` to re-trigger Exensio for fenced sessions
    - After the existing orphan-cleanup loop: group all remaining pending files by sessionId
    - For each session where `isEtlFenceCrossed` returns true and etlComplete list non-empty and Exensio enabled: call `triggerExensioForSession()` immediately
    - Log a clear INFO message per session re-triggered
    - _Requirements: 4.1, 4.2_

- [x] 5. Update `ReloadSessionService` coverage query for new status name
  - [x] 5.1 Update `getFileCoverage()` SQL to include `etl_complete` alongside `exensio_loading` in the `enqueued` bucket
    - In `getFileCoverage()`, the `enqueued` SUM currently matches `'staging','exensio_loading'`
    - Change to: `IN ('staging','exensio_loading','etl_complete')`
    - _Requirements: 1.1_

- [x] 6. Update frontend FileStatusItem and monitoring UI
  - [x] 6.1 Add `etl_complete` to `FileStatusItem.fileStatus` union type in `xfcs-models.ts`
    - Add `'etl_complete'` to the union: `'pending' | 'staging' | 'etl_complete' | 'completed' | 'failed' | 'unverified-exensio'`
    - _Requirements: 5.4_

  - [x] 6.2 Update `statusLabelText()` (or equivalent) in `XfcsFileMonitorComponent` to handle `etl_complete`
    - Add case: `'etl_complete'` → `'ETL Complete – awaiting Exensio'`
    - Ensure stale `'exensio_loading'` values (if any reach the frontend) also map to the same label
    - _Requirements: 5.2_

  - [ ]* 6.3 Write property test for status label mapping
    - **Property 6: status label mapping is exhaustive and correct**
    - **Validates: Requirements 5.2**

  - [x] 6.4 Add "Staged" and "Finished" time columns to the file table in `XfcsFileMonitorComponent`
    - Render `item.createdAt` as "Staged" column using Angular date pipe (`'short'` format)
    - Render `item.resolvedAt` as "Finished" column; show `'—'` when null
    - Column headers: `Staged` and `Finished`
    - _Requirements: 6.1, 6.2_

  - [ ]* 6.5 Write property test for timing column rendering
    - **Property 7: timing fields surfaced for all file statuses**
    - **Validates: Requirements 6.1, 6.2**

- [x] 7. Final checkpoint — ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- `exensio_loading` is kept as a recognized value in `ETL_COMPLETE_STATUSES` throughout — the Liquibase migration handles DB rows but a rolling deploy may see old values briefly
- `ExensioClient` is unchanged — it already batches by schema correctly
- No new DB columns are needed; `file_status` VARCHAR(32) already accommodates `"etl_complete"`
