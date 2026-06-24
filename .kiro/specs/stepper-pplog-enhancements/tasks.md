# Implementation Plan: Stepper Enhancements & pp_log Integration

## Overview

Implementation is split into four tracks:
1. Frontend stepper reset controls
2. Frontend lot statistics and CSV export
3. Backend `PpLogQueryService` (new service)
4. Backend wiring into `ReloadPendingMonitor` and `ReloadSessionService`

---

## Tasks

- [x] 1. Implement global reset and per-block clear on Step 1
  - [x] 1.1 Add `resetAll()` method and "Reset All" button to `XfcsStepperComponent`
    - Add `resetAll()` to the component class: set `environment('')`, reset `searchRows` to one empty default block, clear `searchResults([])`, `selectedFiles([])`, `executionTerminalStatus('')`
    - Add "Reset All" button to Step 1 pane footer (secondary variant, left of "Search Archive")
    - _Requirements: 1.1, 1.2, 1.3_

  - [ ]* 1.2 Write property test for resetAll
    - **Property 1: Reset All produces clean initial state**
    - **Validates: Requirements 1.2, 1.3**

  - [x] 1.3 Add `clearBlockLots(id)` method and "Clear Lots" button to each criteria block
    - Add `clearBlockLots(id: number)` to component: update matching row to `lots: [], lotsRaw: ''`
    - Add "Clear Lots" button inside each `.row-header` (only shown when `row.lots.length > 0`)
    - _Requirements: 2.1, 2.2, 2.3_

  - [ ]* 1.4 Write property test for clearBlockLots
    - **Property 2: Clear Block Lots isolates to target block**
    - **Validates: Requirements 2.2**

- [x] 2. Implement lot statistics and CSV export on Step 2
  - [x] 2.1 Add `lotStats` computed signal to `XfcsStepperComponent`
    - Compute unique entered lots from all `searchRows`, found lots from `searchResults`, not-found as the difference
    - _Requirements: 3.1_

  - [ ]* 2.2 Write property test for lot stats computation
    - **Property 3: Lot statistics computation is correct**
    - **Validates: Requirements 3.1**

  - [x] 2.3 Add `buildNotFoundCsv(lots: string[]): string` and `exportNotFoundCsv()` to `XfcsStepperComponent`
    - `buildNotFoundCsv`: returns `"lot_id\n"` + one line per lot
    - `exportNotFoundCsv`: builds filename `lots-not-found-<YYYYMMDDHHmmss>.csv`, triggers browser download
    - _Requirements: 3.3, 3.4_

  - [ ]* 2.4 Write property test for CSV round-trip
    - **Property 4: CSV export round-trip**
    - **Validates: Requirements 3.4**

  - [x] 2.5 Add lot stats summary panel and export button to Step 2 template
    - Show total entered / found / not-found counts always after a search
    - Show collapsible not-found lot list and "Export Not Found" button only when `lotStats().totalNotFound > 0`
    - _Requirements: 3.1, 3.2, 3.3, 3.5_

- [ ] 3. Checkpoint — ensure frontend builds and all frontend tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement `PpLogQueryService` backend service
  - [x] 4.1 Create `PpLogQueryService.java` with pure static parsing methods
    - Implement `deriveDestination(String outputDirectory)`: "sandbox" → SANDBOX, "NotProcessed" → NOT_PROCESSED, else PRODUCTION (all case-insensitive)
    - Implement `extractSandboxReason(String logMessage)`: split by `" --- "`, return first segment containing "Bad" or "Not found" (case-insensitive), trimmed; null if none
    - Implement `extractErrorReason(String logMessage)`: split by `" --- "`, return last non-empty segment trimmed; if trivial, return first segment with "Bad"/"Not found"; null if none
    - _Requirements: 4.3, 5.2, 6.2_

  - [ ]* 4.2 Write property test for deriveDestination
    - **Property 6: Destination derivation from OUTPUT_DIRECTORY**
    - **Validates: Requirements 4.3**

  - [ ]* 4.3 Write property test for extractSandboxReason
    - **Property 7: Sandbox reason extraction from LOG_MESSAGE**
    - **Validates: Requirements 5.2**

  - [ ]* 4.4 Write property test for extractErrorReason
    - **Property 8: NotProcessed error reason extraction from LOG_MESSAGE**
    - **Validates: Requirements 6.2**

  - [x] 4.5 Implement `queryByLotAndEnv(String lot, String environment, String fileName)` in `PpLogQueryService`
    - Split `fileName` on last `.` to derive `fileNameNoExt` and `extension`
    - Execute native SQL: `SELECT OUTPUT_DIRECTORY, LOG_MESSAGE FROM refdb.pp_log WHERE LOT = :lot AND UPPER(ENVIRONMENT) = UPPER(:env) AND FILE_NAME = :fileNameNoExt AND UPPER(EXTENSION) = UPPER(:ext) ORDER BY PROCESS_DATETIME DESC FETCH FIRST 1 ROWS ONLY`
    - If no `.` in filename: query without EXTENSION filter
    - Return `PpLogResult(destination, reason)` or null on no result / exception
    - Annotate `@Service`, inject `EntityManager` via `@PersistenceContext`
    - _Requirements: 4.1, 4.2, 4.6_

  - [ ]* 4.6 Write property test for most-recent row selection
    - **Property 5: Most-recent pp_log row selection**
    - **Validates: Requirements 4.2**

  - [x] 4.7 Write unit tests for `PpLogQueryService` static methods
    - Test `deriveDestination` with specific examples: "sandbox", "SANDBOX/path", "NotProcessed/file", "production/path", null, empty
    - Test `extractSandboxReason` with the sample row from spec: `"PartNo Not Specified..sending file to sandbox --- Good. Meta Found ... --- Test name should not be blank. ---  at ... line 950."`
    - Test `extractErrorReason` with same sample row
    - _Requirements: 4.3, 5.2, 6.2_

- [x] 5. Wire `PpLogQueryService` into `ReloadPendingMonitor`
  - [x] 5.1 Inject `PpLogQueryService` (`@Autowired(required = false)`) into `ReloadPendingMonitor`
    - _Requirements: 4.6_

  - [x] 5.2 Update `NotProcessed` branch in `scanPendingFiles()` to use `pp_log` first
    - Call `ppLogQueryService.queryByLotAndEnv(pf.getUserLotId(), pf.getEnvironment(), pf.getFileName())`
    - If result non-null and reason non-blank → use as `errorReason`, skip `.err` file
    - Else fall back to existing `tryReadErrReason(foundPath.toString())`
    - If both null → set `"ETL rejected file. No detail available."`
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

- [x] 6. Wire `PpLogQueryService` into `ReloadSessionService`
  - [x] 6.1 Inject `PpLogQueryService` (`@Autowired(required = false)`) into `ReloadSessionService`
    - _Requirements: 4.6_

  - [x] 6.2 Update `enrichDestinationFromLogs()` to query `pp_log` first for destination
    - For each file with no `destinationFolder`, call `ppLogQueryService.queryByLotAndEnv(userLotId, environment, fileName)`
    - If result non-null and destination non-blank → set `destinationFolder`; if SANDBOX and result has reason → set `errorReason`; skip `.log` file path
    - Else fall back to existing `inferDestinationFromLog()` and `extractSandboxReason()` chain
    - _Requirements: 4.1, 4.4, 4.5, 5.1, 5.3, 5.4_

- [x] 7. Update monitoring UI to display error reasons prominently
  - [x] 7.1 Update `statusDetailText()` in `XfcsFileMonitorComponent` to always include `errorReason` for failed files
    - Ensure failed files show `FAILED - [<errorReason>]` in the status detail cell
    - Ensure the error column in the non-embedded table shows full `errorReason` with tooltip
    - _Requirements: 6.6_

  - [x] 7.2 Verify sandbox reason displays in `statusDetailText()` for completed SANDBOX files
    - `statusDetailText()` already has `COMPLETED - SANDBOX [${reason}]` — verify it renders with `pp_log`-sourced reason
    - _Requirements: 5.5_

- [ ] 8. Final checkpoint — ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.
