# Requirements Document

## Introduction

The XFCS Reloader session monitoring UI currently shows per-file status (pending / staging / completed / failed) but does not indicate whether a successfully processed file was delivered to a **PRODUCTION** or **SANDBOX** environment. This information is available in the ETL log file whose path is stored in the `.cfg` file under the `--log` flag (already parsed by `CfgFileParser` into `EnvResolutionInfo.logPath`). This spec defines requirements to:

1. Expose the log file path from the backend to the frontend via the existing `envInfo` endpoint.
2. Parse the ETL log file on the backend to determine per-file processing outcome (PRODUCTION vs SANDBOX) for completed files.
3. Surface this information in a fully redesigned, modern Sessions UI that follows industry-standard UX patterns.

## Glossary

- **Session**: A single reload job identified by a UUID, containing one or more files staged to the ETL inbox.
- **ETL_Log**: The log file written by the ETL pipeline, whose path is extracted from the `--log` flag in the environment's `.cfg` file.
- **Log_Path**: The expanded absolute path to the ETL_Log file, resolved from `EnvResolutionInfo.logPath`.
- **Processing_Destination**: The environment tier to which a file was delivered after ETL processing — either `PRODUCTION` or `SANDBOX`.
- **File_Status**: The per-file lifecycle state: `pending` → `staging` → `completed` | `failed`.
- **EnvResolutionInfo**: The backend record produced by `EnvFolderResolver` that contains `cfgFilePath`, `inboxPath`, `outboxPath`, `logPath`, `locationCode`, and `configSource`.
- **Session_Monitor**: The backend component (`ReloadPendingMonitor`) responsible for scanning pending files and finalizing sessions.
- **Sessions_Table**: The frontend component (`XfcsSessionsComponent`) that lists all reload sessions with expandable file-level details.
- **Destination_Badge**: A UI badge displayed per file indicating `PRODUCTION` or `SANDBOX` processing destination.
- **Terminal_Status**: One of `completed`, `failed`, `partially_failed`, or `cancelled`.

---

## Requirements

### Requirement 1: Expose Log File Path from Backend

**User Story:** As a developer, I want the backend to expose the ETL log file path for each environment, so that the frontend and other services can locate the log file without re-parsing the `.cfg` file.

#### Acceptance Criteria

1. WHEN the `GET /api/xfcs/envs/{environment}/info` endpoint is called, THE Backend SHALL include the `logPath` field (from `EnvResolutionInfo.logPath`) in the response JSON.
2. IF `EnvResolutionInfo.logPath` is null or blank, THEN THE Backend SHALL return `null` for the `logPath` field without error.
3. THE `EnvInfo` TypeScript interface SHALL include an optional `logPath?: string` field.

---

### Requirement 2: Parse ETL Log to Determine Processing Destination

**User Story:** As an operator, I want to know whether each completed file was processed to PRODUCTION or SANDBOX, so that I can verify the reload reached the correct environment tier.

#### Acceptance Criteria

1. WHEN a file transitions to `completed` status, THE Session_Monitor SHALL attempt to read the ETL_Log file at the `Log_Path` for the session's environment.
2. WHEN the ETL_Log is read, THE Session_Monitor SHALL search for a log entry matching the completed file's name and extract the Processing_Destination (`PRODUCTION` or `SANDBOX`).
3. IF a matching log entry is found, THEN THE Session_Monitor SHALL store the Processing_Destination in the `ReloadPendingFileEntity.destinationFolder` field.
4. IF no matching log entry is found or the ETL_Log is unavailable, THEN THE Session_Monitor SHALL leave `destinationFolder` as `null` without failing the file transition.
5. THE `FileStatusDto` SHALL include the `destinationFolder` field in the `GET /api/xfcs/reload/{sessionId}/files` response.
6. THE `FileStatusItem` TypeScript interface SHALL include an optional `processingDestination?: 'PRODUCTION' | 'SANDBOX' | null` field mapped from `destinationFolder`.

---

### Requirement 3: Sessions Table — Modern Layout and Visual Hierarchy

**User Story:** As an operator, I want the Sessions Table to use a modern, information-dense layout with clear visual hierarchy, so that I can quickly scan session status and drill into file details without cognitive overload.

#### Acceptance Criteria

1. THE Sessions_Table SHALL display columns: expand toggle, Session ID (truncated to 8 chars with copy-on-click), Requester, Environment badge, Files count, Progress bar with percentage, Status badge, and Updated timestamp.
2. WHEN a session row is expanded, THE Sessions_Table SHALL display a file detail panel with a sticky header showing file count, completed count, and failed count.
3. THE Sessions_Table SHALL use a frosted-glass card container with a subtle border and box-shadow consistent with the existing design system (`glass-panel` class).
4. THE Sessions_Table SHALL support a loading skeleton state while sessions are being fetched.
5. WHEN the sessions list is empty and not loading, THE Sessions_Table SHALL display a centered empty-state illustration with a descriptive message.
6. THE Sessions_Table SHALL display the most recently updated session at the top (sorted by `updatedAt` descending).

---

### Requirement 4: Per-File Destination Badge

**User Story:** As an operator, I want each completed file in the expanded session detail to show a PRODUCTION or SANDBOX badge, so that I can immediately confirm the processing destination without reading raw log output.

#### Acceptance Criteria

1. WHEN a file has `fileStatus === 'completed'` and `processingDestination === 'PRODUCTION'`, THE Sessions_Table SHALL display a green `PRODUCTION` badge next to the file name.
2. WHEN a file has `fileStatus === 'completed'` and `processingDestination === 'SANDBOX'`, THE Sessions_Table SHALL display an amber `SANDBOX` badge next to the file name.
3. WHEN a file has `fileStatus === 'completed'` and `processingDestination` is null, THE Sessions_Table SHALL display a gray `UNKNOWN` badge.
4. WHEN a file has `fileStatus === 'failed'`, THE Sessions_Table SHALL display a red `FAILED` badge and show the `errorReason` inline below the file name.
5. WHEN a file has `fileStatus === 'pending'` or `'staging'`, THE Sessions_Table SHALL display the corresponding status badge without a destination badge.

---

### Requirement 5: Session-Level Destination Summary

**User Story:** As an operator, I want to see at a glance how many files in a session went to PRODUCTION vs SANDBOX, so that I can quickly validate the reload outcome without expanding every file.

#### Acceptance Criteria

1. WHEN a session row is expanded and file status data is loaded, THE Sessions_Table SHALL display a summary row showing: total files, completed to PRODUCTION count, completed to SANDBOX count, and failed count.
2. THE summary counts SHALL update reactively when the file status data changes.
3. WHEN all completed files have `processingDestination === 'PRODUCTION'`, THE Sessions_Table SHALL display a single `ALL PRODUCTION` indicator in the summary.
4. WHEN all completed files have `processingDestination === 'SANDBOX'`, THE Sessions_Table SHALL display a single `ALL SANDBOX` indicator in the summary.

---

### Requirement 6: Responsive and Accessible Design

**User Story:** As an operator using various screen sizes, I want the Sessions Table to remain usable on smaller viewports, so that I can monitor sessions from any device.

#### Acceptance Criteria

1. THE Sessions_Table SHALL be horizontally scrollable on viewports narrower than 768px without breaking the layout.
2. THE Sessions_Table SHALL maintain a minimum row height of 52px for touch-friendly interaction.
3. WHEN a status badge or destination badge is rendered, THE Sessions_Table SHALL include an `aria-label` attribute describing the status for screen reader accessibility.
4. THE Sessions_Table SHALL support both dark and light themes via the existing CSS variable system (`--text-main`, `--text-muted`, `--accent-color`, `--success`, `--error`).

---

### Requirement 7: Copy Session ID

**User Story:** As an operator, I want to copy a full session ID to the clipboard with a single click, so that I can quickly share or reference it without manual selection.

#### Acceptance Criteria

1. WHEN a user clicks the truncated Session ID cell, THE Sessions_Table SHALL copy the full `sessionId` to the clipboard.
2. WHEN the copy succeeds, THE Sessions_Table SHALL display a transient `Copied!` tooltip for 1.5 seconds.
3. IF the Clipboard API is unavailable, THEN THE Sessions_Table SHALL silently skip the copy without showing an error.

---

### Requirement 8: Session Detail Modal

**User Story:** As an operator, I want to open a full-screen session detail modal by clicking a session row, so that I can inspect analytics charts and file-level details without leaving the sessions list.

#### Acceptance Criteria

1. WHEN a user clicks a session row, THE Sessions_Table SHALL open a Session_Detail_Modal overlaying the page with the full session ID, status badge, updated timestamp, and action buttons (Refresh, Export Files CSV, Cancel, Close).
2. WHEN the Session_Detail_Modal is open, THE Session_Detail_Modal SHALL display a collapsible Session Analytics panel containing a date-range selector, quick-preset buttons (Today, Last 7d, Last 30d, Last 90d, This Month, All), a status summary bar, a Daily Status Trend bar chart, and a Status Distribution donut chart.
3. WHEN the Session_Detail_Modal is opened, THE Session_Detail_Modal SHALL default the analytics date range to the `createdAt` field of the earliest file in the session.
4. WHEN a user selects a date range and clicks Apply Range, THE Session_Detail_Modal SHALL filter the chart data to only include files whose `createdAt` falls within the selected range.
5. WHEN the Session_Detail_Modal is open, THE Session_Detail_Modal SHALL display a collapsible Files Details panel showing a table with columns: Lot, Filename, Status, Destination, Created, End Time.
6. WHEN the Session_Detail_Modal is open and the user clicks Close or the backdrop, THE Session_Detail_Modal SHALL close and return focus to the sessions list.
7. THE Session_Detail_Modal SHALL use ECharts for rendering the Daily Status Trend bar chart and Status Distribution donut chart.
8. WHEN the Session_Detail_Modal is open, THE Session_Detail_Modal SHALL display a status summary showing completed percentage, failed percentage, cancelled percentage, and total file count derived from the filtered file list.

---

### Requirement 9: Session Analytics Data

**User Story:** As an operator, I want the session analytics charts to reflect per-file status grouped by day, so that I can see how files were processed over time.

#### Acceptance Criteria

1. THE Daily_Status_Trend_Chart SHALL group files by the date portion of `createdAt` and display stacked bars for Done, Enqueued, Failed, Cancelled, and Staged counts per day.
2. THE Status_Distribution_Chart SHALL display a donut chart with segments for Completed, Failed, Cancelled, and Enqueued counts across all files in the filtered range.
3. WHEN no files fall within the selected date range, THE Session_Detail_Modal SHALL display a "No data available" message in place of the charts.
4. THE analytics computations SHALL be performed client-side from the already-loaded `FileStatusItem` array without additional API calls.
