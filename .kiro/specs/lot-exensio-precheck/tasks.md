# Implementation Plan: Lot Exensio Pre-Check

## Overview

Implement the Exensio pre-check feature across backend (Snowflake JDBC service + endpoint) and frontend (stepper changes + warning dialog). Tasks are ordered so each step builds on the previous, ending with full wiring.

## Tasks

- [x] 1. Add backend DTOs for pre-check request and response
  - `ExensioPreCheckRequest.java` — `environment`, `lotIds`, `blocks` (unchanged)
  - `PreCheckBlock.java` — `year`, `month`, `lots` (unchanged)
  - Update `ExensioPreCheckRow.java` to `{ lotId, schemaName }` (remove `endTime`, `ppid`, `waferId`)
  - `ExensioPreCheckResponse.java` — `lotsFound`, `lotsNotFound`, `rows`, `error` (unchanged structure)
  - _Requirements: 2.1, 2.5_

- [x] 2. Add Snowflake JDBC dependency and DataSource configuration
  - Add `net.snowflake:snowflake-jdbc:3.14.4` to `pom.xml`
  - Add `snowflake.*` properties to `application.yml` (`url`, `username: ${SNOW_USER}`, `password: ${SNOW_PASS}`, `driver-class-name`)
  - Create `SnowflakeDataSourceConfig.java` — `@Bean("snowflakeDataSource")` using `DriverManagerDataSource` or HikariCP
  - _Requirements: 2.2_

- [x] 3. Rewrite `ExensioPreCheckService` to use Snowflake JDBC with Exensio HTTP fallback
  - [x] 3.1 Implement `buildLotIdsJson(List<String> lotIds)` helper
    - Serialize lot IDs to a JSON array string for use as a JDBC `PARSE_JSON(?)` bind parameter
    - Escape any double-quotes within lot ID values
    - _Requirements: 2.2, 7.1, 7.6_

  - [x]* 3.2 Write property test for `buildLotIdsJson()` — JSON array completeness
    - **Property 2: JSON lot array contains every submitted lot ID**
    - **Validates: Requirements 2.2, 7.1**

  - [x] 3.3 Implement `deriveEarliestYearMonth(List<PreCheckBlock> blocks)` helper
    - Returns a `'YYYY-MM'` formatted string for the earliest year+month across all blocks
    - Returns year + `-01` when only a year is present (no month)
    - Returns `null` when no blocks have a year set (no date filter)
    - _Requirements: 2.3, 7.3_

  - [x]* 3.4 Write property test for `deriveEarliestYearMonth()` — bind param format
    - **Property 3: Year-month bind parameter resolves to correct month start**
    - **Validates: Requirements 2.3, 7.3**

  - [x] 3.5 Implement `partitionResults(List<ExensioPreCheckRow> rows, List<String> submittedLotIds)` helper
    - Rows with `schemaName = 'NOT FOUND'` → `lotsNotFound`
    - Rows with any other `schemaName` → `lotsFound`
    - Uses case-insensitive matching against submitted lot IDs
    - _Requirements: 2.5, 7.5_

  - [x]* 3.6 Write property test for response partitioning
    - **Property 4: Response partitioning is a complete, non-overlapping cover**
    - **Property 5: NOT FOUND rows are excluded from lotsFound**
    - **Validates: Requirements 2.5, 7.5**

  - [x] 3.7 Implement primary `checkViaSnowflake(ExensioPreCheckRequest)` method
    - Validate empty lot list → return empty response immediately
    - Call `buildLotIdsJson()` and `deriveEarliestYearMonth()`
    - Acquire `Connection` from `snowflakeDataSource`
    - Execute parameterized SQL (`LOT_CHECK_SQL_WITH_DATE` or `LOT_CHECK_SQL_NO_DATE`)
    - Read `ResultSet` into `List<ExensioPreCheckRow>`, call `partitionResults()`
    - On any `SQLException`: log warning and return `null` to signal fallback
    - _Requirements: 2.2, 2.3, 2.4, 2.5_

  - [x] 3.8 Implement fallback `checkViaExensioHttp(ExensioPreCheckRequest)` method
    - Re-use existing `buildSql()` Oracle query logic from the original service
    - Call `POST /v1/key/raw-sql` via `ExensioAuthService` (retry on 401)
    - Parse JSON response and partition using `parseResponse()`
    - On network error / 5xx: return soft-failure response with `error` field set
    - _Requirements: 2.6_

  - [x] 3.9 Implement `check(ExensioPreCheckRequest)` orchestration method
    - Try `checkViaSnowflake()` first; if it returns `null`, call `checkViaExensioHttp()`
    - If both fail: return `ExensioPreCheckResponse` with `error` field set and empty lists
    - _Requirements: 2.6_

- [x] 4. Expose pre-check endpoint in `XfcsController`
  - Add `@PostMapping("/lots/exensio-precheck")` delegating to `exensioPreCheckService.check()`
  - _Requirements: 2.1_

- [x] 5. Checkpoint — verify backend compiles and service logic is correct
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Add/update frontend TypeScript models and API method
  - Update `ExensioPreCheckRow` interface in `xfcs-models.ts` to `{ lotId: string; schemaName: string }`
  - Ensure `runExensioPreCheck(req)` method exists in `XfcsApiService`
  - _Requirements: 2.1_

- [x] 7. Create `ExensioPreCheckDialogComponent`
  - [x] 7.1 Implement component class
    - `@Input() result: ExensioPreCheckResponse`
    - `@Input() environment: string`
    - `@Output() proceed` and `@Output() goBack` emitters
    - `exportCsv()`: header `lot_id,schema_loaded`, body rows from `result.rows`, escape double-quotes, Blob download named `exensio-precheck-<environment>-<timestamp>.csv`
    - _Requirements: 3.1–3.7, 4.1–4.5_

  - [x]* 7.2 Write property test for CSV row count
    - **Property 6: CSV row count equals pre-check rows count**
    - **Validates: Requirements 4.3**

  - [x]* 7.3 Write property test for CSV header columns
    - **Property 7: CSV output contains required columns in the header**
    - **Validates: Requirements 4.2**

  - [x] 7.4 Implement component template
    - Header: "⚠ Lots Found in Exensio"
    - Summary: "X of Y lots already found in Exensio"
    - Scrollable table (max 400 px): `lot_id | schema_loaded`
    - Buttons: "Export CSV", "Go Back", "Proceed Anyway"
    - _Requirements: 3.2, 3.3, 3.4_

  - [x]* 7.5 Write property test for dialog count summary rendering
    - **Property 10: Dialog shows correct count summary**
    - **Validates: Requirements 3.3**

- [x] 8. Update `XfcsStepperComponent`
  - [x] 8.1 Add pre-check signals
    - Add `preChecking`, `preCheckResult`, `preCheckStale`, `showPreCheckDlg` signals
    - Add `preCheckEnabled` signal initialised from `localStorage` key `xfcs.precheck.enabled` (default `true`)
    - Implement `onPreCheckToggle(enabled: boolean)` updating the signal and persisting to `localStorage`
    - _Requirements: 1.3, 5.1, 5.2, 5.4, 5.5_

  - [x] 8.2 Implement `buildPreCheckRequest()` helper
    - Collect and deduplicate all lots across `searchRows()`
    - Build `blocks` array preserving per-row `year` and `month`
    - _Requirements: 1.2_

  - [x]* 8.3 Write property test for `buildPreCheckRequest()` deduplication
    - **Property 1: Pre-check request contains all deduplicated lot IDs**
    - **Validates: Requirements 1.2**

  - [x] 8.4 Implement `onSearchClick()` orchestration
    - If `preCheckEnabled()` is false → call `performSearch()` and return
    - Otherwise call `buildPreCheckRequest()` and `api.runExensioPreCheck()`
    - Set/clear `preChecking` signal in try/finally
    - On `lotsFound.length > 0` (no error): set `showPreCheckDlg(true)` and return
    - On empty `lotsFound` or soft error: log warning if error, call `performSearch()`
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 5.3_

  - [x] 8.5 Update `resetAll()` to clear pre-check state
    - Set `preCheckResult(null)`, `preCheckStale(false)`, `showPreCheckDlg(false)`
    - _Requirements: 6.1_

  - [x]* 8.6 Write property test for reset clearing state
    - **Property 8: Reset clears pre-check state**
    - **Validates: Requirements 6.1**

  - [x] 8.7 Add stale tracking in `updateRow()` and `removeLot()`
    - When `preCheckResult()` is non-null, call `preCheckStale.set(true)`
    - _Requirements: 6.2_

  - [x]* 8.8 Write property test for mutation marking stale
    - **Property 9: Mutation marks pre-check result as stale**
    - **Validates: Requirements 6.2**

  - [x] 8.9 Update Step 1 template
    - Search button: `(clicked)="onSearchClick()"`
    - Loading: `[loading]="searching() || preChecking()"`
    - Loading label: `preChecking() ? 'Checking Exensio…' : 'Searching Archives…'`
    - Checkbox near Search button bound to `preCheckEnabled()` / `onPreCheckToggle()`
    - Add `<app-exensio-precheck-dialog>` overlay wired to `showPreCheckDlg()`, `result`, `environment`, `(proceed)`, `(goBack)`
    - _Requirements: 1.1, 1.3, 3.1, 3.5, 3.6, 5.1, 5.2_

  - [x]* 8.10 Write property tests for toggle behavior
    - **Property 11: Pre-check skipped when toggle is disabled**
    - **Property 12: Toggle state persisted to localStorage**
    - **Validates: Requirements 5.3, 5.4**

- [x] 9. Final checkpoint — ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Backend property tests use **jqwik** (already in pom.xml); frontend property tests use **fast-check**
- Each property test should run a minimum of 100 iterations
- The pre-check uses Snowflake JDBC as primary; falls back to Exensio HTTP raw-SQL on failure
- Either path failing silently allows the user to proceed to the archive search
- `ExensioPreCheckRow` shape change (removing `endTime`/`ppid`/`waferId`, adding `schemaName`) affects both the Java record and the TypeScript interface — complete task 1 and 6 before proceeding to dialog/stepper work
