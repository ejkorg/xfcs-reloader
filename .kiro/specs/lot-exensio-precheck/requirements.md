# Requirements Document

## Introduction

Before the user advances from Step 1 (Target Selection) to Step 2 (File Discovery), this feature adds a pre-check that queries the Snowflake data warehouse to determine whether the entered lots already exist in Exensio within the selected year/month range. If any lots are found, the user is warned and asked whether to continue. The full query result can be exported to CSV.

The intent is to surface "lot already processed" situations early — before the archive search runs — so users do not waste time requesting a reload for lots that Exensio already has recorded.

## Glossary

- **Exensio**: The downstream tester-data platform that stores processed lot/wafer records. Its data is mirrored into the Snowflake table `ANALYTICSPRD.MFG.EXENSIO_PROD_OPLOG_METADATA`.
- **Snowflake**: The cloud data warehouse queried via JDBC using the Snowflake JDBC driver. The ODBC DSN `MART_SNOWFLAKE` is pre-configured on the server; credentials are supplied via `$SNOW_USER` / `$SNOW_PASS` environment variables (with TOTP appended to the password).
- **EXENSIO_PROD_OPLOG_METADATA**: The Snowflake table (`ANALYTICSPRD.MFG.EXENSIO_PROD_OPLOG_METADATA`) that holds lot oplog records including `LOT_ID`, `SCHEMANAME`, `PGC_KEY`, and `INSERT_TIME`.
- **INSERT_TIME**: The `INSERT_TIME` column in `EXENSIO_PROD_OPLOG_METADATA` — the timestamp when the lot's record was inserted into Snowflake.
- **SCHEMANAME**: The Exensio schema (e.g. `PRODUCTION`, `SANDBOX`) in which the lot was processed, returned alongside each lot result.
- **ExensioPreCheckResult**: The backend DTO returned by `POST /xfcs/lots/exensio-precheck`; contains per-lot found/schema status plus all matching rows.
- **PreCheck dialog**: The modal warning shown in Step 1 when one or more lots are found.
- **SearchRow**: An existing structure in `XfcsStepperComponent` representing one criteria block (year, month, lot IDs).
- **Stepper**: The `XfcsStepperComponent` multi-step wizard.
- **SnowflakePreCheckService**: The new backend `@Service` that executes the Snowflake JDBC query.

---

## Requirements

### Requirement 1: Pre-Check Trigger

**User Story:** As a user, I want the system to automatically check whether my entered lots already exist in Exensio before moving to Step 2, so that I am warned before submitting a reload for lots that may already be processed.

#### Acceptance Criteria

1. WHEN the user clicks "Search Archive →" in Step 1, THE Stepper SHALL call the Exensio pre-check before executing the archive search.
2. THE Stepper SHALL send all lot IDs from all criteria blocks (deduplicated), along with the selected environment, and each block's year and month (when specified), to the pre-check endpoint.
3. WHILE the pre-check is running, THE Stepper SHALL display a loading indicator with the message "Checking Exensio…".
4. WHEN the pre-check completes with no lots found, THE Stepper SHALL proceed directly to the archive search without interruption.
5. IF the pre-check call fails (network error or non-2xx response), THEN THE Stepper SHALL log a warning and proceed to the archive search without blocking the user.

---

### Requirement 2: Pre-Check Backend Endpoint

**User Story:** As a developer, I want a dedicated backend endpoint that accepts lot IDs and criteria and queries Snowflake, so that the frontend can determine which lots already exist in Exensio.

#### Acceptance Criteria

1. THE Backend SHALL expose `POST /api/xfcs/lots/exensio-precheck` accepting a JSON body with `environment`, `lotIds` (string array), and optional `blocks` (array of `{ year?, month?, lots[] }`).
2. WHEN the endpoint is called, THE Backend SHALL query Snowflake via JDBC using a parameterized query that matches `LOT_ID` against the submitted lot IDs using a `FLATTEN / PARSE_JSON` array parameter.
3. WHEN a `year` and `month` are provided in any block, THE Backend SHALL add a date-range filter on `INSERT_TIME` restricting results to that calendar month using `TO_DATE(? || '-01', 'YYYY-MM-DD')` as the lower bound.
4. THE Backend query SHALL filter by `PGC_KEY = 2` (Final Test records) and return `LOT_ID` and `SCHEMANAME` per matching row.
5. THE Backend SHALL return a response containing: `lotsFound` (list of lot IDs that matched), `lotsNotFound` (list of lot IDs with no record), and `rows` (flat list of matching records with `lotId` and `schemaName`).
6. IF the Snowflake JDBC connection fails, THEN THE Backend SHALL return HTTP 200 with `{ "error": "<message>", "lotsFound": [], "lotsNotFound": [] }` so the frontend can treat it as a soft failure.
7. THE Backend SHALL prefer the schema `PRODUCTION` over other schema names when a lot appears in multiple schemas (ranked by `SCHEMANAME LIKE '%PROD%'`).

---

### Requirement 3: Warning Dialog

**User Story:** As a user, I want to see a clear warning that lists which lots already exist in Exensio, so that I can decide whether to continue or go back and change my selection.

#### Acceptance Criteria

1. WHEN the pre-check returns one or more lots in `lotsFound`, THE Stepper SHALL display a modal warning dialog before proceeding.
2. THE Warning Dialog SHALL list each found lot ID and the `schemaName` from Snowflake.
3. THE Warning Dialog SHALL display a count summary: "X of Y lots already found in Exensio".
4. THE Warning Dialog SHALL present two actions: "Proceed Anyway" and "Go Back".
5. WHEN the user clicks "Proceed Anyway", THE Stepper SHALL close the dialog and continue to the archive search.
6. WHEN the user clicks "Go Back", THE Stepper SHALL close the dialog and return focus to Step 1 without running the archive search.
7. THE Warning Dialog SHALL include an "Export to CSV" button that downloads the pre-check results as a CSV file.

---

### Requirement 4: CSV Export

**User Story:** As a user, I want to export the pre-check results to a CSV file, so that I can review or share which lots were already found.

#### Acceptance Criteria

1. WHEN the user clicks "Export to CSV" in the Warning Dialog, THE Stepper SHALL generate and download a CSV file named `exensio-precheck-<environment>-<timestamp>.csv`.
2. THE CSV file SHALL contain the columns: `lot_id`, `schema_loaded`.
3. THE CSV file SHALL include one row per record returned in `rows` from the pre-check response.
4. THE CSV file SHALL include a header row with column names.
5. THE CSV generation SHALL be performed client-side using the data already returned by the pre-check response — no additional API call is required.

---

### Requirement 5: Pre-Check Toggle

**User Story:** As a user, I want to enable or disable the Exensio pre-check from the UI, so that I can skip it when I know the lots are new or when I want a faster workflow.

#### Acceptance Criteria

1. THE Stepper SHALL display a checkbox labeled "Check Exensio before searching" in Step 1.
2. WHEN the checkbox is checked, THE Stepper SHALL run the pre-check before the archive search (default behavior).
3. WHEN the checkbox is unchecked, THE Stepper SHALL skip the pre-check and proceed directly to the archive search.
4. THE Stepper SHALL persist the checkbox state to `localStorage` so the user's preference is remembered across sessions.
5. THE checkbox SHALL default to checked (pre-check enabled) when no stored preference exists.

---

### Requirement 6: Pre-Check Reset

**User Story:** As a user, I want the pre-check state to be cleared when I reset Step 1, so that stale results do not carry over to a new search.

#### Acceptance Criteria

1. WHEN the user clicks "Reset All" in Step 1, THE Stepper SHALL clear any stored pre-check results.
2. WHEN the lot IDs or year/month in any criteria block change after a pre-check was run, THE Stepper SHALL mark the previous pre-check result as stale (it does not need to re-run automatically).

---

### Requirement 7: Snowflake Query Design

**User Story:** As a developer, I want the backend to use a correct and efficient parameterized Snowflake SQL query, so that the date-range and lot-match logic is accurate and injection-safe.

#### Acceptance Criteria

1. THE Backend query SHALL use `ANALYTICSPRD.MFG.EXENSIO_PROD_OPLOG_METADATA` and use `TABLE(FLATTEN(PARSE_JSON(?)))` to pass the lot ID list as a single JSON array bind parameter.
2. THE Backend query SHALL filter by `PGC_KEY = 2` and match `LOT_ID IN (SELECT lot_id FROM provided_lots)`.
3. WHEN a year+month filter is provided, THE Backend query SHALL add `INSERT_TIME >= TO_DATE(? || '-01', 'YYYY-MM-DD')` as a bind parameter using the `'YYYY-MM'` formatted string.
4. THE Backend query SHALL rank results using `ROW_NUMBER() OVER (PARTITION BY LOT_ID ORDER BY CASE WHEN UPPER(SCHEMANAME) LIKE '%PROD%' THEN 0 ELSE 1 END)` and return only rank-1 rows.
5. THE Backend query SHALL return `NOT FOUND` as the `schema_loaded` value for lot IDs that matched no Snowflake record (via `COALESCE(r.SCHEMANAME, 'NOT FOUND')`).
6. THE Backend query SHALL use bind parameters for all user-supplied values — no string interpolation of lot IDs or dates into the SQL.
7. THE Backend query SHALL order results by `schema_loaded, lot_id`.
