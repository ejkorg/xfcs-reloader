# Requirements Document

## Introduction

This feature enhances the XFCS Reloader stepper and monitoring with four improvements:
1. Reset capability on Step 1 (global) and on each individual criteria block
2. Lot input statistics: total lots entered, lots not found in archive, with CSV export
3. Use `refdb.pp_log` table (production Oracle instance) as the primary source for ETL destination and Sandbox reason — falling back to the existing `.log` file method
4. Continue reading `.err` file as the primary source for file error reasons, displaying them in the UI

## Glossary

- **Stepper**: The 4-step Angular component (`XfcsStepperComponent`) guiding users through Selection → Discovery → Review → Execution
- **Criteria Block**: A single search row in Step 1 containing optional Year, Month, and a list of Lot IDs
- **pp_log**: The Oracle table `refdb.pp_log` on the production Oracle instance. Key columns used:
  - `LOT` — the lot ID (VARCHAR2 32), used to match against `userLotId`
  - `ENVIRONMENT` — the environment name (VARCHAR2 32), used to scope queries
  - `FILE_NAME` — the processed filename (VARCHAR2 255), used for precise file matching
  - `OUTPUT_DIRECTORY` — the ETL output path (VARCHAR2 255); contains `NotProcessed` for rejected files, `sandbox`/`SANDBOX` for sandbox-routed files, or a production path
  - `LOG_MESSAGE` — the full ETL log message (VARCHAR2 2000); segments are separated by ` --- `; segments containing "Bad" or "Not found" (case-insensitive) carry the meaningful error/reason text
  - `PROCESS_DATETIME` — used for ordering to get the most recent record when multiple exist
- **Production Oracle Instance**: The Oracle DB at `exnqa-db.onsemi.com:1740/EXNQA.onsemi.com` using credentials from `application-onsemi-oracle.yml` (user `refdb`). This is the same datasource the app already uses — not a separate QA instance
- **Destination**: The ETL output target: either `PRODUCTION` or `SANDBOX`, derived from `OUTPUT_DIRECTORY` in `pp_log`
- **Sandbox Reason**: The first ` --- `-delimited segment in `LOG_MESSAGE` that contains "Bad" or "Not found" (case-insensitive), for records where `OUTPUT_DIRECTORY` contains "sandbox"
- **Error Reason (NotProcessed)**: The last ` --- `-delimited segment of `LOG_MESSAGE` (or the first segment containing "Bad"/"Not found") for records where `OUTPUT_DIRECTORY` contains "NotProcessed"
- **ETL Log File**: The `.log` file on the filesystem (resolved via `--log` flag in `.cfg` or convention path), used as secondary fallback for destination detection
- **Error Reason (.err)**: Text extracted from the `.err` sibling file when ETL moves a file to `NotProcessed/`, used as secondary fallback after `pp_log`
- **Lots Not Found**: Lot IDs entered by the user in Step 1 that returned zero archive search results
- **CSV Export**: A browser-triggered download of a comma-separated file containing lot ID summary data

## Requirements

### Requirement 1: Global Reset on Step 1

**User Story:** As a user, I want to reset the entire Step 1 form back to its initial state, so that I can start a new search from scratch without navigating away.

#### Acceptance Criteria

1. WHEN the user is on Step 1, THE Stepper SHALL display a "Reset All" button in the step footer alongside the existing "Search Archive" button
2. WHEN the user clicks "Reset All", THE Stepper SHALL clear the environment selection, remove all criteria blocks except one empty default block, and reset all lot chip inputs to empty
3. WHEN the user clicks "Reset All", THE Stepper SHALL reset any search results and selected files from a previous search

---

### Requirement 2: Per-Block Reset on Step 1

**User Story:** As a user, I want to reset an individual criteria block's lot IDs, so that I can clear a specific block without affecting others.

#### Acceptance Criteria

1. WHEN a criteria block contains at least one lot chip, THE Stepper SHALL display a "Clear Lots" button within that block's header
2. WHEN the user clicks "Clear Lots" on a block, THE Stepper SHALL remove all lot chips from that block and reset its `lotsRaw` field to empty
3. WHEN a criteria block has no lot chips, THE "Clear Lots" button SHALL NOT be displayed for that block

---

### Requirement 3: Lot Input Statistics and CSV Export

**User Story:** As a user, I want to see how many lots I entered and which ones were not found in the archive after a search, so that I can identify missing lots and export them for follow-up.

#### Acceptance Criteria

1. WHEN a search completes and the user is on Step 2, THE Stepper SHALL display a summary showing: total unique lot IDs entered across all blocks, total lots found (with at least one archive file), and total lots not found
2. WHEN there are lots not found, THE Stepper SHALL display the list of not-found lot IDs
3. WHEN there are lots not found, THE Stepper SHALL display an "Export Not Found" button that triggers a CSV download
4. WHEN the user clicks "Export Not Found", THE Stepper SHALL download a CSV file named `lots-not-found-<timestamp>.csv` containing a header row `lot_id` and one row per not-found lot ID
5. WHEN all entered lots are found, THE Stepper SHALL NOT display the "Export Not Found" button

---

### Requirement 4: pp_log as Primary Destination Source

**User Story:** As a user, I want the monitoring view to show the correct ETL destination (PRODUCTION or SANDBOX) by querying the `refdb.pp_log` production Oracle table first, so that destination data is accurate and available sooner.

#### Acceptance Criteria

1. WHEN a file reaches ETL-completed status, THE ReloadSessionService SHALL first query `refdb.pp_log` to determine the destination (PRODUCTION or SANDBOX) for that file, filtered by: `LOT` matching the file's `userLotId`, `ENVIRONMENT` matching the session environment, `FILE_NAME` matching the filename stem (without extension), and `EXTENSION` matching the file extension (both case-insensitive)
2. WHEN multiple `pp_log` rows match, THE PpLogQueryService SHALL use the row with the most recent `PROCESS_DATETIME`
3. WHEN a matching `pp_log` row is found, THE PpLogQueryService SHALL derive destination as: `SANDBOX` if `OUTPUT_DIRECTORY` contains "sandbox" (case-insensitive), `NotProcessed` if `OUTPUT_DIRECTORY` contains "NotProcessed" (case-insensitive), otherwise `PRODUCTION`
4. WHEN `pp_log` returns a destination, THE ReloadSessionService SHALL use it and SHALL NOT fall back to the `.log` file method
5. WHEN `pp_log` returns no matching record or the query fails, THE ReloadSessionService SHALL fall back to the existing `.log` file method (local read then SSH remote grep)
6. THE PpLogQueryService SHALL use the production Oracle datasource (`refdb` user, `exnqa-db.onsemi.com:1740/EXNQA`) — the same datasource already configured in `application-onsemi-oracle.yml`

---

### Requirement 5: pp_log as Primary Sandbox Reason Source

**User Story:** As a user, I want the monitoring view to show the Sandbox reason from `refdb.pp_log`, so that I know why a file was routed to SANDBOX directly from the authoritative ETL log table.

#### Acceptance Criteria

1. WHEN a file's destination is determined to be SANDBOX via `pp_log`, THE PpLogQueryService SHALL extract the sandbox reason from the `LOG_MESSAGE` field of the matching row
2. THE PpLogQueryService SHALL split `LOG_MESSAGE` by the delimiter ` --- ` and return the first segment that contains the word "Bad" or "Not found" (case-insensitive) as the sandbox reason
3. WHEN a sandbox reason is extracted from `pp_log`, THE ReloadSessionService SHALL store it as `errorReason` and SHALL NOT fall back to the `.log` file method for the reason
4. WHEN no qualifying segment is found in `LOG_MESSAGE`, THE ReloadSessionService SHALL fall back to the existing `.log` file grep method for sandbox reason extraction
5. THE monitoring UI SHALL display the sandbox reason in the file status detail text when the destination is SANDBOX and a reason is available

---

### Requirement 6: pp_log as Primary Error Source for NotProcessed Files

**User Story:** As a user, I want errors from the `refdb.pp_log` table to be shown in the monitoring UI with priority for NotProcessed files, so that I see the authoritative ETL rejection reason from the database record.

#### Acceptance Criteria

1. WHEN a file is moved to `NotProcessed/`, THE ReloadPendingMonitor SHALL first query `refdb.pp_log` for the error reason, filtered by `LOT`, `ENVIRONMENT`, `FILE_NAME` (stem without extension), and `EXTENSION`, using the most recent `PROCESS_DATETIME` row where `OUTPUT_DIRECTORY` contains "NotProcessed" (case-insensitive)
2. WHEN a matching `pp_log` row is found, THE PpLogQueryService SHALL extract the error reason by splitting `LOG_MESSAGE` by ` --- ` and returning the last non-empty segment; if the last segment is not meaningful, it SHALL use the first segment containing "Bad" or "Not found" (case-insensitive)
3. WHEN a non-empty reason is extracted from `pp_log`, THE ReloadPendingMonitor SHALL store it in the `errorReason` field of the `ReloadPendingFileEntity` and SHALL NOT read the `.err` file
4. IF `pp_log` returns no matching record, the query fails, or yields an empty reason, THEN THE ReloadPendingMonitor SHALL fall back to reading the `.err` sibling file (case-insensitive: `.err` or `.ERR`)
5. IF neither `pp_log` nor the `.err` file yields a reason, THEN THE ReloadPendingMonitor SHALL set a generic error reason indicating no detail is available
6. WHEN the monitoring UI receives a `FileStatusItem` with `fileStatus === 'failed'` and a non-empty `errorReason`, THE UI SHALL display the error reason in the file row status detail and the error column
