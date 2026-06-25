# Design Document: Session-Gated Exensio Lookup

## Overview

This feature refactors `ReloadPendingMonitor` to fire a single, well-timed Exensio batch
API call **per session** — only once all files in that session have cleared ETL pre-processing.
It also renames the intermediate file status from `exensio_loading` to `etl_complete`,
exposes per-file timing (`createdAt`, `resolvedAt`) in the monitoring UI, and adds
resume-on-restart logic for sessions interrupted mid-flight.

The REST endpoint `/v1/key/lot-wafer-lookup` (already used) is kept as-is. No raw-SQL
endpoint is introduced — `ExensioClient` already batches all lots for a schema in one HTTP
call, which is sufficient.

---

## Architecture

```
ReloadPendingMonitor.scanPendingFiles()
│
├── For each pending file:
│   ├── pending/staging → ETL not done yet, keep scanning
│   ├── Processed/      → transition to etl_complete (was exensio_loading)
│   │                      publish file_etl_completed SSE event
│   ├── NotProcessed/   → transition to failed, publish file_failed
│   └── ReworkFiles/    → transition to failed, publish file_failed
│
├── After processing all files in this scan cycle:
│   └── For each session that had at least one file transition:
│       └── isEtlFenceCrossed(sessionId)?
│           ├── YES (all files in etl_complete | failed | terminal)
│           │   └── exensioEnabled?
│           │       ├── YES → triggerExensioForSession(sessionId)
│           │       │         → finalize session
│           │       └── NO  → mark all etl_complete files as completed
│           │                  → finalize session
│           └── NO  → keep scanning next cycle
│
└── cleanupOrphanedPendingFiles() on startup
    └── detect sessions where ALL files are already etl_complete
        └── re-trigger Exensio batch (resume after restart)

triggerExensioForSession(sessionId)
  → pendingFileRepository.findBySessionIdAndFileStatus(sessionId, ["etl_complete","exensio_loading"])
  → ExensioClient.lotWaferLookupBatch(files)   ← one call, groups by schema internally
  → update each file: DONE→completed, NOT_FOUND/ERROR→unverified-exensio (if timeout elapsed)
  → pendingFileRepository.save + delete
  → finalizeSessionIfDone(sessionId)
```

---

## Components and Interfaces

### `ReloadPendingMonitor` changes

#### Status constant update

```java
// Old
pf.setFileStatus("exensio_loading");

// New
pf.setFileStatus("etl_complete");
```

The monitor also reads rows with `"exensio_loading"` (legacy value) and treats them
identically to `"etl_complete"` everywhere:

```java
private static final Set<String> ETL_COMPLETE_STATUSES =
    Set.of("etl_complete", "exensio_loading"); // exensio_loading: backward compat
```

#### ETL fence predicate (new, pure function)

```java
/**
 * Returns true when all files for this session have cleared ETL pre-processing,
 * meaning none remain in "pending" or "staging" state.
 *
 * An empty set (session has no pending rows) returns false — the session either
 * finished already or has nothing to confirm.
 */
static boolean isEtlFenceCrossed(List<ReloadPendingFileEntity> sessionFiles) {
    if (sessionFiles == null || sessionFiles.isEmpty()) return false;
    return sessionFiles.stream()
        .noneMatch(f -> "pending".equals(f.getFileStatus())
                     || "staging".equals(f.getFileStatus()));
}
```

#### Trigger point change

Current flow (per scan cycle):
```java
// CURRENT — fires every cycle with whatever happened to be in exensio_loading
List<ReloadPendingFileEntity> exensioLoading = pendingFileRepository.findByFileStatus("exensio_loading");
if (!exensioLoading.isEmpty()) {
    processExensioLoading(exensioLoading, sessionsToFinalize);
}
```

New flow:
```java
// NEW — group all pending files by session, check fence per session
Map<String, List<ReloadPendingFileEntity>> bySession =
    pending.stream().collect(Collectors.groupingBy(ReloadPendingFileEntity::getSessionId));

for (Map.Entry<String, List<ReloadPendingFileEntity>> entry : bySession.entrySet()) {
    String sessionId = entry.getKey();
    List<ReloadPendingFileEntity> sessionFiles = entry.getValue();

    if (!isEtlFenceCrossed(sessionFiles)) continue;  // still waiting for ETL

    List<ReloadPendingFileEntity> etlComplete = sessionFiles.stream()
        .filter(f -> ETL_COMPLETE_STATUSES.contains(f.getFileStatus()))
        .toList();

    if (etlComplete.isEmpty()) {
        // All files failed/terminal — skip Exensio, just finalize
        sessionsToFinalize.add(sessionId);
        continue;
    }

    if (exensioProperties.isEnabled()) {
        triggerExensioForSession(sessionId, etlComplete, sessionsToFinalize);
    } else {
        // Exensio disabled: promote all etl_complete directly to completed
        for (ReloadPendingFileEntity pf : etlComplete) {
            pf.setFileStatus("completed");
            pf.setResolvedAt(Instant.now());
            pendingFileRepository.save(pf);
            appendEvent(pf.getSessionId(), "file_completed",
                buildEtlProcessedMsg(pf, pf.getDestinationFolder(),
                    exensioProperties.resolvedDbschemaForDestination(pf.getDestinationFolder()), false),
                pf.getRequester(), null);
            toRemove.add(pf.getAbsPath());
        }
        sessionsToFinalize.add(sessionId);
    }
}
```

#### `triggerExensioForSession(sessionId, etlComplete, sessionsToFinalize)`

Extracted from the current `processExensioLoading()`, with one key change: it receives only the
files for **one session** rather than all accumulated `exensio_loading` files across all sessions.
Logic for DONE/NOT_FOUND/ERROR handling is unchanged.

#### Resume on startup: `cleanupOrphanedPendingFiles()` extension

```java
// On startup, re-trigger Exensio for sessions where fence is already crossed
Map<String, List<ReloadPendingFileEntity>> bySession =
    allPending.stream().collect(Collectors.groupingBy(ReloadPendingFileEntity::getSessionId));

for (Map.Entry<String, List<ReloadPendingFileEntity>> entry : bySession.entrySet()) {
    if (isEtlFenceCrossed(entry.getValue())) {
        List<ReloadPendingFileEntity> etlComplete = entry.getValue().stream()
            .filter(f -> ETL_COMPLETE_STATUSES.contains(f.getFileStatus()))
            .toList();
        if (!etlComplete.isEmpty() && exensioProperties.isEnabled()) {
            triggerExensioForSession(entry.getKey(), etlComplete, new HashSet<>());
        }
    }
}
```

---

### `FileStatusDto` / `FileStatusItem` changes

`FileStatusDto` already carries `createdAt` and `resolvedAt` (`Instant`).

**Backend: no change needed** — the DTO already maps from `ReloadPendingFileEntity`.

**Frontend `FileStatusItem` in `xfcs-models.ts`:**

```typescript
export interface FileStatusItem {
  absPath: string;
  fileName?: string;
  originalFileName?: string;
  userLotId?: string;
  fileStatus: 'pending' | 'staging' | 'etl_complete' | 'etl_complete_legacy'
             | 'completed' | 'failed' | 'unverified-exensio';
  errorReason?: string;
  resolvedPath?: string;
  destinationFolder?: string;
  createdAt?: string;    // ISO-8601, already present — ensure UI surfaces it
  resolvedAt?: string;   // ISO-8601, already present — ensure UI surfaces it
}
```

**Frontend `XfcsFileMonitorComponent` changes:**

1. Status label mapping — add `etl_complete` case:
```typescript
statusLabelText(item: FileStatusItem): string {
  switch (item.fileStatus) {
    case 'etl_complete':
    case 'etl_complete_legacy':  // guard for any stale UI payloads
      return 'ETL Complete – awaiting Exensio';
    case 'completed':
      return item.destinationFolder
        ? `Completed [${item.destinationFolder}]`
        : 'Completed';
    // ... existing cases
  }
}
```

2. Timing columns — add "Staged" and "Finished" columns to the file table:
```html
<td>{{ item.createdAt | date:'short' }}</td>   <!-- Staged -->
<td>{{ item.resolvedAt | date:'short' }}</td>  <!-- Finished -->
```

---

## Data Models

No new DB tables or columns. The `file_status` column already holds VARCHAR(32),
so `"etl_complete"` (12 chars) fits without migration.

A Liquibase changeset should update any existing `exensio_loading` rows on deploy:
```xml
<changeSet id="7.1-rename-exensio-loading-status" author="xfcs-reloader">
    <update tableName="xfcs_dearchiver_reload_pending_files">
        <column name="file_status" value="etl_complete"/>
        <where>file_status = 'exensio_loading'</where>
    </update>
</changeSet>
```

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

---

### Property 1: ETL fence predicate correctness

*For any* non-empty list of `ReloadPendingFileEntity` objects, `isEtlFenceCrossed(files)` SHALL return `true` if and only if none of the files have `fileStatus` equal to `"pending"` or `"staging"`. For an empty list it SHALL return `false`.

**Validates: Requirements 2.1, 2.2**

---

### Property 2: Backward-compatible status treatment

*For any* list of files where some have `fileStatus = "exensio_loading"` and some have `fileStatus = "etl_complete"`, `isEtlFenceCrossed` SHALL treat both values identically — neither blocks the fence crossing.

**Validates: Requirements 1.2, 2.1**

---

### Property 3: One batch call per session when fence is crossed

*For any* session where `isEtlFenceCrossed` returns `true` and there is at least one `etl_complete` file, `triggerExensioForSession` SHALL be called exactly once for that session per scan cycle, and the files passed to `ExensioClient.lotWaferLookupBatch()` SHALL include all and only the `etl_complete` files for that session.

**Validates: Requirements 3.1**

---

### Property 4: Exensio-disabled path marks files completed immediately

*For any* session where `isEtlFenceCrossed` returns `true` and `exensioProperties.isEnabled() == false`, after the scan cycle all `etl_complete` files for that session SHALL have `fileStatus = "completed"` and a non-null `resolvedAt`. No call to `ExensioClient` is made.

**Validates: Requirements 3.4**

---

### Property 5: SSE event published on etl_complete transition

*For any* file that transitions from `staging` (file found in `Processed/`) with Exensio enabled, the monitor SHALL emit exactly one SSE event with `eventType = "file_etl_completed"` for that file.

**Validates: Requirements 5.1**

---

### Property 6: Status label mapping is exhaustive and correct

*For any* `FileStatusItem` with a known `fileStatus` value, `statusLabelText(item)` SHALL return a non-empty string. For `fileStatus = "etl_complete"`, it SHALL return a string containing `"ETL Complete"`.

**Validates: Requirements 5.2**

---

### Property 7: Timing fields are surfaced for all file statuses

*For any* `FileStatusItem` with a non-null `createdAt` field, the rendered file row SHALL contain a non-empty formatted date string in the "Staged" column. Same for `resolvedAt` in the "Finished" column.

**Validates: Requirements 6.1, 6.2**

---

## Error Handling

| Scenario | Behavior |
|---|---|
| Exensio API call fails (all retries exhausted) | Files remain `etl_complete` in DB; NOT_FOUND/ERROR updates applied per timeout logic; eventually `unverified-exensio` after `timeoutMinutes` |
| Session fence crossed but all files failed/notprocessed | `etlComplete` list is empty → skip Exensio, call `finalizeSessionIfDone` directly |
| Backend restart with files in `exensio_loading` | `cleanupOrphanedPendingFiles()` detects fence crossed → re-triggers Exensio batch |
| Backend restart with files in `pending`/`staging` | Normal scan cycle resumes; no data loss since staging table is source of truth |
| Liquibase migration renames `exensio_loading` rows | `ETL_COMPLETE_STATUSES` set provides double-safety during rolling deployment |
| `etl_complete` files have no `destinationFolder` | `ExensioClient` returns ERROR for them (existing behaviour: "Destination folder not yet determined") |

---

## Testing Strategy

### Unit Tests (jqwik / fast-check)

**Backend (jqwik):**
- `isEtlFenceCrossed`: specific examples — all pending, all etl_complete, mixed, empty list
- `triggerExensioForSession` with mock `ExensioClient`: verify exactly one call with correct file list
- Resume path in `cleanupOrphanedPendingFiles()`: all-etl_complete session triggers batch on startup

**Frontend (fast-check):**
- `statusLabelText()`: specific values for each `fileStatus` enum member
- Timing column rendering: null `createdAt`/`resolvedAt` shows empty/dash; non-null shows formatted date

### Property-Based Tests

Uses **jqwik** (Java) and **fast-check** (TypeScript). Minimum **100 iterations** per property.

- **Property 1** — Tag: `Feature: session-gated-exensio-lookup, Property 1: ETL fence predicate`
  Generate random lists of `ReloadPendingFileEntity` with random statuses from the full status vocabulary. Assert fence result matches the "none are pending/staging" predicate.

- **Property 2** — Tag: `Feature: session-gated-exensio-lookup, Property 2: backward compat status treatment`
  Generate lists mixing `"exensio_loading"` and `"etl_complete"` with non-pending/staging other statuses. Assert fence returns true for all such inputs.

- **Property 3** — Tag: `Feature: session-gated-exensio-lookup, Property 3: one batch call per session`
  Generate random sessions with random counts of etl_complete files. Assert `ExensioClient.lotWaferLookupBatch()` is called exactly once and receives all etl_complete files.

- **Property 4** — Tag: `Feature: session-gated-exensio-lookup, Property 4: exensio-disabled path`
  Generate random sessions with exensio disabled. Assert all etl_complete files transition to completed and no ExensioClient call fires.

- **Property 5** — Tag: `Feature: session-gated-exensio-lookup, Property 5: SSE event on etl_complete`
  Generate random file entities that complete ETL. Assert exactly one `file_etl_completed` event is published per file transition.

- **Property 6** — Tag: `Feature: session-gated-exensio-lookup, Property 6: status label exhaustive`
  Generate any `fileStatus` string from the known set. Assert `statusLabelText()` returns non-empty string and etl_complete maps to the expected label.

- **Property 7** — Tag: `Feature: session-gated-exensio-lookup, Property 7: timing fields surfaced`
  Generate random ISO-8601 timestamps for `createdAt`/`resolvedAt`. Assert rendered output contains a formatted non-empty date string.
