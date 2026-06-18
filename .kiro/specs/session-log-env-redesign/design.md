# Design Document: Session Log & Environment Destination Redesign

## Overview

This design covers two tightly coupled concerns:

1. **Backend**: Expose the ETL log file path (`--log` from `.cfg`) via the `envInfo` endpoint, add a `destination_folder` column to `xfcs_dearchiver_reload_pending_files`, and populate it by detecting `PRODUCTION` or `SANDBOX` in the resolved file path when a file is marked `completed` (the `detectDestinationFolder` helper already exists in `ReloadPendingMonitor`).

2. **Frontend**: Fully redesign `XfcsSessionsComponent` with a modern, information-dense layout — loading skeletons, empty states, per-file PRODUCTION/SANDBOX/UNKNOWN destination badges, a session-level destination summary, click-to-copy session ID, and full dark/light theme support.

The existing `detectDestinationFolder(String path)` method in `ReloadPendingMonitor` already checks for `/production/` and `/sandbox/` in the resolved file path. The primary backend work is persisting that result and surfacing it through the API.

---

## Architecture

```mermaid
graph TD
    subgraph Backend
        Monitor[ReloadPendingMonitor]
        Entity[ReloadPendingFileEntity]
        DTO[FileStatusDto]
        Controller[XfcsController]
        Resolver[EnvFolderResolver]
    end

    subgraph Frontend
        Sessions[XfcsSessionsComponent]
        ApiSvc[XfcsApiService]
        Models[xfcs-models.ts]
    end

    Monitor -->|sets destinationFolder| Entity
    Entity -->|mapped to| DTO
    Controller -->|GET /reload/{id}/files| DTO
    Controller -->|GET /envs/{env}/info includes logPath| Resolver

    ApiSvc -->|getSessionFiles()| DTO
    ApiSvc -->|getEnvInfo()| Controller
    Sessions -->|renders| Models
```

---

## Components and Interfaces

### Backend

#### ReloadPendingFileEntity (modified)

Add a `destination_folder` column to persist the detected processing destination:

```java
@Column(name = "destination_folder", length = 32)
private String destinationFolder;  // "PRODUCTION" | "SANDBOX" | null
```

#### ReloadPendingMonitor (modified)

In the `completed` branch of `scanPendingFiles()`, after calling `detectDestinationFolder(foundStr)`, persist the result to the entity before removing it from the pending table:

```java
// existing code already calls detectDestinationFolder — just persist it:
String destination = detectDestinationFolder(foundStr);
pf.setDestinationFolder(destination);
pf.setFileStatus("completed");
pf.setResolvedAt(Instant.now());
pendingFileRepository.save(pf);
```

The `detectDestinationFolder` method already exists and checks for `/production/` and `/sandbox/` in the path. No changes needed to the detection logic.

#### FileStatusDto (modified)

Add `destinationFolder` to the existing record (it already exists in the DTO — verify it's being populated from the entity):

```java
public record FileStatusDto(
    String absPath,
    String fileName,
    String originalFileName,
    String userLotId,
    String fileStatus,
    String errorReason,
    String resolvedPath,
    String destinationFolder,   // "PRODUCTION" | "SANDBOX" | null
    Instant createdAt,
    Instant resolvedAt
) {}
```

`FileStatusDto` already has `destinationFolder` — the mapping in `ReloadSessionService.getSessionFiles()` must be verified to populate it from `entity.getDestinationFolder()`.

#### XfcsController — envInfo endpoint (modified)

Add `logPath` to the response map in `GET /api/xfcs/envs/{environment}/info`:

```java
if (resolution != null) {
    out.put("rawInboxPath", resolution.rawInboxPath());
    out.put("outboxPath", resolution.outboxPath());
    out.put("locationCode", resolution.locationCode());
    out.put("logPath", resolution.logPath());   // NEW
}
```

### Frontend

#### xfcs-models.ts (modified)

```typescript
// Add logPath to EnvInfo
export interface EnvInfo {
  environment: string;
  cfgPath: string;
  inboxPath: string;
  fileCount: number;
  active: boolean;
  configSource?: string;
  logPath?: string;           // NEW — from --log flag in .cfg
}

// FileStatusItem already has destinationFolder — add typed processingDestination
export interface FileStatusItem {
  absPath: string;
  fileName: string;
  originalFileName?: string;
  userLotId?: string;
  fileStatus: 'pending' | 'staging' | 'completed' | 'failed';
  errorReason?: string;
  resolvedPath?: string;
  destinationFolder?: string;
  processingDestination?: 'PRODUCTION' | 'SANDBOX' | null;  // NEW — derived from destinationFolder
  createdAt?: string;
  resolvedAt?: string;
}
```

#### XfcsSessionsComponent (redesigned)

The component is fully redesigned. Key structural changes:

**Template structure:**
```
glass-panel
  ├── header (title + refresh button + active session count badge)
  ├── loading skeleton (shown while loading === true)
  ├── empty state (shown when sessions.length === 0 && !loading)
  └── table-wrap
        └── hub-table
              ├── thead (fixed columns)
              └── tbody
                    └── ng-container *ngFor="let s of sortedSessions()"
                          ├── session-row (click → toggleExpand)
                          │     ├── expand-toggle
                          │     ├── session-id (click → copyId, shows Copied! tooltip)
                          │     ├── requester
                          │     ├── env-badge
                          │     ├── files count
                          │     ├── progress-cell (bar + %)
                          │     ├── status-badge (with aria-label)
                          │     └── updated timestamp
                          └── detail-row (shown when expanded)
                                ├── detail-summary-bar
                                │     ├── total count
                                │     ├── PRODUCTION count (green)
                                │     ├── SANDBOX count (amber)
                                │     └── failed count (red)
                                └── file-list
                                      └── file-item *ngFor
                                            ├── file icon + name + lot badge
                                            ├── destination-badge (PRODUCTION/SANDBOX/UNKNOWN)
                                            ├── file-status-badge (with aria-label)
                                            └── error-reason (if failed)
```

**Computed signals:**
```typescript
sortedSessions = computed(() =>
  [...this.sessions()].sort((a, b) =>
    new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime()
  )
);

destinationSummary(files: FileStatusItem[]) {
  const completed = files.filter(f => f.fileStatus === 'completed');
  return {
    total: files.length,
    production: completed.filter(f => f.processingDestination === 'PRODUCTION').length,
    sandbox: completed.filter(f => f.processingDestination === 'SANDBOX').length,
    failed: files.filter(f => f.fileStatus === 'failed').length,
  };
}
```

**Copy session ID:**
```typescript
async copySessionId(id: string) {
  try {
    await navigator.clipboard.writeText(id);
    this.copiedId.set(id);
    setTimeout(() => this.copiedId.set(null), 1500);
  } catch { /* silently ignore */ }
}
```

**FileStatusItem mapping** — map `destinationFolder` to typed `processingDestination` in `loadFileStatus()`:
```typescript
files.map(f => ({
  ...f,
  processingDestination: f.destinationFolder === 'PRODUCTION' ? 'PRODUCTION'
    : f.destinationFolder === 'SANDBOX' ? 'SANDBOX'
    : null
}))
```

#### Session Detail Modal (new)

The session row click opens a full-screen modal overlay (matching dtp-resender's `detail-overlay` / `detail-modal` pattern). The modal is rendered inline in `XfcsSessionsComponent` — no separate component needed.

**Modal structure:**
```
detail-overlay (fixed, full-screen, backdrop blur)
  └── detail-modal (max 1180px × 860px, scrollable)
        ├── detail-head (sticky)
        │     ├── title: "Session Detail — {truncatedId}"
        │     ├── status-badge + updated timestamp + Copy ID button
        │     └── actions: Refresh | Export Files CSV | Cancel | Close
        ├── metrics bar (total / completed / failed / status pills)
        ├── charts-section (collapsible, default expanded)
        │     ├── charts-toggle button
        │     └── charts-panel
        │           ├── charts-head
        │           │     ├── title + subtitle
        │           │     ├── date-range controls (From / To inputs + Apply / Clear)
        │           │     ├── preset-row (Today / Last 7d / Last 30d / Last 90d / This Month / All)
        │           │     └── status-summary pills (Completed X% / Failed X% / Cancelled X% / Total N)
        │           └── charts-grid (2 columns)
        │                 ├── chart-card: Daily Status Trend (ECharts bar)
        │                 └── chart-card: Status Distribution (ECharts donut)
        └── files-section (collapsible, default expanded)
              ├── files-toggle button: "Files Details (N)"
              └── detail-table-wrap
                    └── hub-table.files
                          ├── thead: Lot | Filename | Status | Destination | Created | End Time
                          └── tbody: *ngFor file rows
```

**New signals and computed values:**
```typescript
selectedSession = signal<ReloadStatus | null>(null);
selectedFiles = signal<FileStatusItem[]>([]);
chartsExpanded = signal(true);
filesTableExpanded = signal(true);
analyticsStartDate = signal<string | null>(null);
analyticsEndDate = signal<string | null>(null);

// Filtered files for analytics (by date range)
filteredFiles = computed(() => {
  const files = this.selectedFiles();
  const start = this.analyticsStartDate();
  const end = this.analyticsEndDate();
  if (!start && !end) return files;
  return files.filter(f => {
    if (!f.createdAt) return true;
    const d = f.createdAt.substring(0, 10);
    if (start && d < start) return false;
    if (end && d > end) return false;
    return true;
  });
});

analyticsStatusSummary = computed(() => {
  const files = this.filteredFiles();
  const total = files.length;
  if (total === 0) return { total: 0, completedPct: 0, failedPct: 0, cancelledPct: 0 };
  const completed = files.filter(f => f.fileStatus === 'completed').length;
  const failed = files.filter(f => f.fileStatus === 'failed').length;
  return {
    total,
    completedPct: Math.round((completed / total) * 100),
    failedPct: Math.round((failed / total) * 100),
    cancelledPct: 0,
  };
});

dailyStatusRows = computed(() => buildDailyTrend(this.filteredFiles()));
```

**`buildDailyTrend(files: FileStatusItem[])` helper:**
```typescript
// Groups files by date(createdAt), returns array of { day, done, failed, staging, pending }
// sorted ascending by day. Used to feed ECharts xAxis categories + series data.
```

**ECharts integration:**
- Use `echarts` npm package (already present in dtp-resender, add to xfcs-reloader if not present)
- Initialize charts in `ngAfterViewInit` / after modal opens using `@ViewChild` refs
- Destroy chart instances `onDestroy` / when modal closes to prevent memory leaks
- Daily Status Trend: stacked bar chart, xAxis = days, series = [Done, Failed, Staging, Pending]
- Status Distribution: donut chart (radius `['55%', '75%']`), data from `analyticsStatusSummary`

**Opening / closing the modal:**
```typescript
selectSession(session: ReloadStatus): void {
  this.selectedSession.set(session);
  this.selectedFiles.set([]);
  this.analyticsStartDate.set(null);
  this.analyticsEndDate.set(null);
  this.loadFileStatus(session.sessionId);
}

closeDetail(): void {
  this.selectedSession.set(null);
  this.destroyCharts();
}
```

**Default date range** — after files load, set `analyticsStartDate` to the earliest `createdAt` date:
```typescript
// After files are loaded:
const earliest = files.reduce((min, f) => f.createdAt && f.createdAt < min ? f.createdAt : min, files[0]?.createdAt ?? '');
if (earliest) this.analyticsStartDate.set(earliest.substring(0, 10));
```

---

## Data Models

### Schema Change

```sql
-- Liquibase changeset: db.changelog-5.7-pending-files-destination.xml
ALTER TABLE xfcs_dearchiver_reload_pending_files
  ADD destination_folder VARCHAR(32);
```

### Entity Addition

```java
@Column(name = "destination_folder", length = 32)
private String destinationFolder;

public String getDestinationFolder() { return destinationFolder; }
public void setDestinationFolder(String destinationFolder) { this.destinationFolder = destinationFolder; }
```

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Log path included in envInfo response

*For any* environment that resolves successfully via `EnvFolderResolver`, calling `GET /api/xfcs/envs/{environment}/info` should return a JSON object containing a `logPath` key whose value matches `EnvResolutionInfo.logPath()`.

**Validates: Requirements 1.1**

---

### Property 2: Destination detection round-trip

*For any* completed file whose resolved path contains `/production/` or `/sandbox/`, after the monitor scan cycle: the `destinationFolder` field stored in the database should equal `"PRODUCTION"` or `"SANDBOX"` respectively, and the `GET /api/xfcs/reload/{sessionId}/files` response should include that value in `destinationFolder`.

**Validates: Requirements 2.2, 2.3, 2.5**

---

### Property 3: Graceful null destination

*For any* completed file whose resolved path does not contain `/production/` or `/sandbox/`, the `destinationFolder` field should be `null` in both the database and the API response, and no exception should be thrown during the scan cycle.

**Validates: Requirements 2.4**

---

### Property 4: Sessions sorted by updatedAt descending

*For any* list of `ReloadStatus` objects with distinct `updatedAt` values, the `sortedSessions` computed signal should return them in descending order of `updatedAt`.

**Validates: Requirements 3.6**

---

### Property 5: Destination badge rendering correctness

*For any* `FileStatusItem`, the rendered destination badge should satisfy:
- `fileStatus === 'completed'` and `processingDestination === 'PRODUCTION'` → green `PRODUCTION` badge with `aria-label="Processed to PRODUCTION"`
- `fileStatus === 'completed'` and `processingDestination === 'SANDBOX'` → amber `SANDBOX` badge with `aria-label="Processed to SANDBOX"`
- `fileStatus === 'completed'` and `processingDestination === null` → gray `UNKNOWN` badge
- `fileStatus === 'failed'` → red `FAILED` badge and `errorReason` visible
- `fileStatus === 'pending'` or `'staging'` → no destination badge rendered

**Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5**

---

### Property 6: Destination summary counts correctness

*For any* list of `FileStatusItem` objects, `destinationSummary()` should return counts where:
- `production` equals the count of items with `fileStatus === 'completed'` and `processingDestination === 'PRODUCTION'`
- `sandbox` equals the count of items with `fileStatus === 'completed'` and `processingDestination === 'SANDBOX'`
- `failed` equals the count of items with `fileStatus === 'failed'`
- `total` equals `files.length`

**Validates: Requirements 5.1, 5.2, 5.3, 5.4**

---

### Property 7: Copy session ID interaction

*For any* session, clicking the session ID cell should invoke `navigator.clipboard.writeText` with the full `sessionId`, and the `copiedId` signal should be set to that `sessionId` for 1.5 seconds before being cleared.

**Validates: Requirements 7.1, 7.2**

---

### Property 8: Analytics date range filter

*For any* array of `FileStatusItem` objects and any date range `[start, end]`, the filtered file list used for chart data should contain only items whose `createdAt` falls within `[start, end]` (inclusive), and the status summary percentages should be computed from that filtered list only.

**Validates: Requirements 8.4, 9.1, 9.2**

---

### Property 9: Daily trend grouping correctness

*For any* array of `FileStatusItem` objects, the daily trend data produced by `buildDailyTrend(files)` should satisfy: for each day `d`, the sum of all status counts for day `d` equals the count of files whose `createdAt` date portion equals `d`.

**Validates: Requirements 9.1**

---

## Error Handling

| Scenario | Backend Behavior | Frontend Behavior |
|---|---|---|
| `logPath` is null in `EnvResolutionInfo` | Return `null` for `logPath` in envInfo response | `EnvInfo.logPath` is `undefined`; no UI impact |
| `destination_folder` column missing (pre-migration) | Liquibase migration runs on startup; column always present | N/A |
| `destinationFolder` is null for completed file | `processingDestination` mapped to `null`; gray `UNKNOWN` badge shown | Graceful degradation |
| Clipboard API unavailable | N/A | `copySessionId()` catches the error silently; no tooltip shown |
| Sessions API returns empty array | N/A | Empty-state panel shown with descriptive message |
| Sessions API returns error | N/A | Toast error shown; loading state cleared |
| Files API returns empty array for selected session | N/A | "No file details available" shown in files table; charts show "No data available" |
| `createdAt` is null on all files | N/A | Date range defaults to null (no filter applied); charts render with all files |
| ECharts fails to initialize | N/A | Chart container shows "No data available" fallback; no exception propagated |

---

## Testing Strategy

### Unit Tests (JUnit 5 + Mockito — backend)

- `ReloadPendingMonitorTest`: verify `destinationFolder` is set to `"PRODUCTION"` when resolved path contains `/production/`, `"SANDBOX"` for `/sandbox/`, and `null` for neither.
- `XfcsControllerTest` (MockMvc): verify `GET /envs/{env}/info` response includes `logPath` field.
- `ReloadSessionServiceTest`: verify `getSessionFiles()` maps `entity.getDestinationFolder()` to `FileStatusDto.destinationFolder()`.

### Property-Based Tests

Use **jqwik** (Java) for backend and **fast-check** (TypeScript) for frontend. Minimum 100 iterations per property.

- **Property 1** — `EnvInfoLogPathProperty`: generate random `EnvResolutionInfo` instances with random `logPath` values (including null), call the controller, assert response `logPath` matches.
  - Tag: `Feature: session-log-env-redesign, Property 1: Log path included in envInfo response`

- **Property 2** — `DestinationRoundTripProperty`: generate random file paths containing `/production/` or `/sandbox/`, simulate a scan cycle, assert `destinationFolder` in DB and API response matches expected value.
  - Tag: `Feature: session-log-env-redesign, Property 2: Destination detection round-trip`

- **Property 3** — `NullDestinationProperty`: generate random file paths that do NOT contain `/production/` or `/sandbox/`, simulate scan, assert `destinationFolder` is null and no exception thrown.
  - Tag: `Feature: session-log-env-redesign, Property 3: Graceful null destination`

- **Property 4** — `SessionSortProperty`: generate random arrays of `ReloadStatus` with random `updatedAt` values, call `sortedSessions()`, assert descending order.
  - Tag: `Feature: session-log-env-redesign, Property 4: Sessions sorted by updatedAt descending`

- **Property 5** — `DestinationBadgeProperty`: generate random `FileStatusItem` objects with all combinations of `fileStatus` and `processingDestination`, render the component, assert badge color class and `aria-label` match the specification.
  - Tag: `Feature: session-log-env-redesign, Property 5: Destination badge rendering correctness`

- **Property 6** — `SummaryCountsProperty`: generate random arrays of `FileStatusItem`, call `destinationSummary()`, assert counts match manual filter counts.
  - Tag: `Feature: session-log-env-redesign, Property 6: Destination summary counts correctness`

- **Property 7** — `CopySessionIdProperty`: generate random session IDs, simulate click on session ID cell, assert `navigator.clipboard.writeText` called with full ID and `copiedId` signal transitions correctly.
  - Tag: `Feature: session-log-env-redesign, Property 7: Copy session ID interaction`

- **Property 8** — `AnalyticsDateRangeFilterProperty`: generate random arrays of `FileStatusItem` with random `createdAt` dates and random `[start, end]` date ranges, call `filteredFiles()`, assert all returned items have `createdAt` within the range.
  - Tag: `Feature: session-log-env-redesign, Property 8: Analytics date range filter`

- **Property 9** — `DailyTrendGroupingProperty`: generate random arrays of `FileStatusItem`, call `buildDailyTrend()`, assert for each day the sum of all status counts equals the count of files with that `createdAt` date.
  - Tag: `Feature: session-log-env-redesign, Property 9: Daily trend grouping correctness`
