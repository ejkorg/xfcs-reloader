# Design Document: Stepper Enhancements & pp_log Integration

## Overview

This feature delivers four improvements to the XFCS Reloader:

1. **Reset controls** — Global "Reset All" on Step 1 and per-block "Clear Lots" buttons
2. **Lot statistics + CSV export** — After search, show entered/found/not-found counts with CSV download on Step 2
3. **`pp_log` as primary source** — Query `refdb.pp_log` (production Oracle) first for destination, sandbox reason, and NotProcessed error reason; fall back to existing `.log` file / `.err` file methods
4. **Error display** — Show `.err`/`pp_log` error reasons prominently in the monitoring UI

---

## Architecture

```
Frontend (Angular)                   Backend (Spring Boot)
──────────────────────────────────   ──────────────────────────────────────────
XfcsStepperComponent                 ReloadPendingMonitor
  - resetAll()                          - scanPendingFiles()
  - clearBlockLots(id)                     → PpLogQueryService.queryByLotAndEnv()
  - lotStats (computed signal)              → tryReadErrReason() [fallback]
  - exportNotFoundCsv()
                                     ReloadSessionService
XfcsFileMonitorComponent               - enrichDestinationFromLogs()
  - statusDetailText() [shows reason]      → PpLogQueryService.queryByLotAndEnv()
  - error column [shows errorReason]        → inferDestinationFromLog() [fallback]
                                          - extractSandboxReason()
                                             → PpLogQueryService (sandbox reason)
                                             → extractSandboxReason() [fallback]

                                     PpLogQueryService  [NEW]
                                       - queryByLotAndEnv(lot, env) → PpLogResult
                                       - deriveDestination(outputDir) → String
                                       - extractSandboxReason(logMsg) → String
                                       - extractErrorReason(logMsg) → String
                                       Uses: existing Spring JPA datasource (refdb Oracle)
```

---

## Components and Interfaces

### Frontend: XfcsStepperComponent changes

**New methods:**
```typescript
resetAll(): void
  // Resets: environment='', searchRows=[default empty row],
  // searchResults=[], selectedFiles=[], executionTerminalStatus=''

clearBlockLots(id: number): void
  // Sets lots=[], lotsRaw='' for the block with matching id
```

**New computed signals:**
```typescript
lotStats = computed(() => {
  // Returns { totalEntered, totalFound, totalNotFound, notFoundLots }
  // totalEntered: unique lot IDs across all searchRows
  // totalFound: lots that appear in at least one searchResult
  // notFoundLots: totalEntered lots minus found lots
})
```

**New method:**
```typescript
exportNotFoundCsv(): void
  // Builds CSV string: header "lot_id" + one line per notFoundLots entry
  // Triggers browser download: lots-not-found-<YYYYMMDDHHmmss>.csv
```

**Template additions:**
- "Reset All" button in Step 1 footer (secondary variant, left-aligned)
- "Clear Lots" button inside each `search-row` header row (only when `row.lots.length > 0`)
- Lot stats summary panel at top of Step 2 results container (always shown after search)
- "Export Not Found" button in Step 2 (only when `lotStats().totalNotFound > 0`)
- Collapsible not-found lot list in Step 2

---

### Backend: PpLogQueryService (new)

New Spring `@Service` that queries `refdb.pp_log` via the existing JPA `EntityManager` / datasource (no second datasource needed — the app already connects to the production Oracle `refdb` schema per `application-onsemi-oracle.yml`).

```java
@Service
public class PpLogQueryService {

    /** Result of a pp_log lookup for a single file. */
    public record PpLogResult(
        String destination,   // "PRODUCTION", "SANDBOX", "NOT_PROCESSED", or null if not found
        String reason         // sandbox or error reason extracted from LOG_MESSAGE, may be null
    ) {}

    /**
     * Queries refdb.pp_log for the most recent record matching the given lot, environment,
     * and filename. The fileName is split internally into FILE_NAME (stem without extension)
     * and EXTENSION for the query.
     * Returns null if no record is found or the query fails.
     */
    public PpLogResult queryByLotAndEnv(String lot, String environment, String fileName);

    /**
     * Derives destination string from OUTPUT_DIRECTORY value.
     *   - contains "sandbox" (case-insensitive) → "SANDBOX"
     *   - contains "NotProcessed" (case-insensitive) → "NOT_PROCESSED"
     *   - otherwise → "PRODUCTION"
     */
    public static String deriveDestination(String outputDirectory);

    /**
     * Extracts sandbox reason from LOG_MESSAGE.
     * Splits by " --- ", returns first segment containing "Bad" or "Not found" (case-insensitive).
     * Returns null if no qualifying segment found.
     */
    public static String extractSandboxReason(String logMessage);

    /**
     * Extracts error reason for NotProcessed files from LOG_MESSAGE.
     * Splits by " --- ", returns the last non-empty segment.
     * If the last segment is blank/trivial, returns the first segment containing
     * "Bad" or "Not found" (case-insensitive).
     * Returns null if LOG_MESSAGE is blank or no meaningful segment found.
     */
    public static String extractErrorReason(String logMessage);
}
```

**SQL query used:**
```sql
SELECT OUTPUT_DIRECTORY, LOG_MESSAGE
FROM refdb.pp_log
WHERE LOT = :lot
  AND UPPER(ENVIRONMENT) = UPPER(:environment)
  AND FILE_NAME = :fileNameNoExt
  AND UPPER(EXTENSION) = UPPER(:extension)
ORDER BY PROCESS_DATETIME DESC
FETCH FIRST 1 ROWS ONLY
```

**Filename decomposition** (performed in `PpLogQueryService.queryByLotAndEnv()`):

Given a file like `P002317366_BIN_reloaded_20260624142138.SPD`:
- Strip any display suffix `[PRODUCTION]` / `[SANDBOX]` appended by the UI layer
- Strip the `_reloaded_<14-digit-timestamp>` suffix → base stem = `P002317366_BIN_reloaded_20260624142138` (keep the stem up to but not including the extension dot)
- Actually: `FILE_NAME` in `pp_log` stores the name **without** extension — so split on the last `.` to separate stem from extension:
  - `fileNameNoExt` = `P002317366_BIN_reloaded_20260624142138` (everything before last `.`)
  - `extension` = `SPD` (everything after last `.`, uppercased)
- If the filename has no `.`, use the full filename as `fileNameNoExt` and pass `NULL` / skip `EXTENSION` filter

Uses `EntityManager.createNativeQuery()` with the existing datasource. Wrapped in try/catch — any exception returns `null` (triggers fallback).

**Method signature update:**
```java
public PpLogResult queryByLotAndEnv(String lot, String environment, String fileName);
// fileName is the full filename as stored in ReloadPendingFileEntity (e.g. P002317366_BIN_reloaded_20260624142138.SPD)
// Method splits internally into FILE_NAME and EXTENSION for the query
```

---

### Backend: ReloadPendingMonitor changes

In the `NotProcessed/` branch of `scanPendingFiles()`:

**New priority order for error reason:**
1. Query `PpLogQueryService.queryByLotAndEnv(pf.getUserLotId(), pf.getEnvironment(), pf.getFileName())`
   - If result is non-null and has a non-blank `reason` → use it as `errorReason`
2. Fall back to existing `tryReadErrReason(foundPath.toString())`
3. If both null → set generic message `"ETL rejected file. No detail available."`

**Also set `destinationFolder`** from `pp_log` result when present in the `NotProcessed` branch (destination = `NOT_PROCESSED` maps to no destination override; keep existing logic).

---

### Backend: ReloadSessionService changes

In `enrichDestinationFromLogs()`, update to call `PpLogQueryService` first:

**New priority order for destination enrichment:**
1. `PpLogQueryService.queryByLotAndEnv(userLotId, environment, fileName)`
   - If result is non-null and destination is non-blank → use it; also extract sandbox reason if SANDBOX
2. Fall back to existing `inferDestinationFromLog()` (local `.log` read → SSH grep)
3. Fall back to existing `extractSandboxReason()` for sandbox reason if `pp_log` had no reason

`PpLogQueryService` is `@Autowired(required = false)` so the service degrades gracefully when not configured (H2 dev profile).

---

## Data Models

No new database tables or entity changes required.

**New DTO (internal, not exposed via API):**
```java
// PpLogQueryService.PpLogResult record (see above)
```

**No changes to `FileStatusDto`, `FileStatusItem`, or API contracts** — `errorReason` and `destinationFolder` fields already exist.

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Reset All produces clean initial state

*For any* stepper state (any environment value, any number of search rows with any lots, any search results, any selected files), after calling `resetAll()`, the resulting state SHALL be: `environment = ''`, `searchRows` contains exactly one block with `lots = []` and `lotsRaw = ''`, `searchResults = []`, `selectedFiles = []`.

**Validates: Requirements 1.2, 1.3**

---

### Property 2: Clear Block Lots isolates to target block

*For any* list of search rows and any valid block id, after calling `clearBlockLots(id)`, the block with that id SHALL have `lots = []` and `lotsRaw = ''`, and all other blocks SHALL be unchanged.

**Validates: Requirements 2.2**

---

### Property 3: Lot statistics computation is correct

*For any* set of input lot IDs (across all search rows) and any set of search results, the computed `lotStats` SHALL satisfy:
- `totalEntered` = count of unique lot IDs in all rows
- `totalFound` = count of unique lot IDs that appear in at least one `SearchResult`
- `totalNotFound` = `totalEntered - totalFound`
- `notFoundLots` = the set difference (entered lots minus found lots)

**Validates: Requirements 3.1**

---

### Property 4: CSV export round-trip

*For any* list of not-found lot IDs, the CSV string generated by `buildNotFoundCsv(lots)` SHALL contain exactly `lots.length + 1` lines (1 header + 1 per lot), the first line SHALL be `"lot_id"`, and each subsequent line SHALL be exactly the corresponding lot ID with no extra characters.

**Validates: Requirements 3.4**

---

### Property 5: Most-recent pp_log row selection

*For any* collection of `pp_log` rows with the same `LOT` and `ENVIRONMENT` but different `PROCESS_DATETIME` values, `PpLogQueryService` SHALL return the row whose `PROCESS_DATETIME` is the maximum (most recent).

**Validates: Requirements 4.2**

---

### Property 6: Destination derivation from OUTPUT_DIRECTORY

*For any* `OUTPUT_DIRECTORY` string, `deriveDestination(outputDirectory)` SHALL return:
- `"SANDBOX"` if the string contains "sandbox" (case-insensitive), regardless of other content
- `"NOT_PROCESSED"` if the string contains "NotProcessed" (case-insensitive) and does not contain "sandbox"
- `"PRODUCTION"` otherwise

**Validates: Requirements 4.3**

---

### Property 7: Sandbox reason extraction from LOG_MESSAGE

*For any* `LOG_MESSAGE` string, `extractSandboxReason(logMessage)` SHALL return the first segment (after splitting by `" --- "`) that contains "Bad" or "Not found" (case-insensitive), trimmed of whitespace. If no such segment exists, it SHALL return `null`.

**Validates: Requirements 5.2**

---

### Property 8: NotProcessed error reason extraction from LOG_MESSAGE

*For any* `LOG_MESSAGE` string, `extractErrorReason(logMessage)` SHALL return the last non-empty segment after splitting by `" --- "`, trimmed. If the last segment is blank or missing, it SHALL return the first segment containing "Bad" or "Not found" (case-insensitive). If no segment qualifies, it SHALL return `null`.

**Validates: Requirements 6.2**

---

## Error Handling

| Scenario | Behavior |
|---|---|
| `pp_log` query throws exception | Catch, log WARN, return null → fallback to `.log` or `.err` |
| `pp_log` returns no rows | Return null → fallback |
| `LOG_MESSAGE` is null/blank | `extractSandboxReason` / `extractErrorReason` return null → fallback |
| `.err` file missing or empty | Existing behavior: return null → generic message |
| Oracle datasource unavailable | `@Autowired(required = false)` PpLogQueryService is null → skip pp_log path |
| `notFoundLots` empty on CSV export | Button not shown — unreachable |

---

## Testing Strategy

### Unit Tests

- `PpLogQueryService.deriveDestination()`: specific examples for "sandbox", "SANDBOX", "NotProcessed", production paths, null, empty string
- `PpLogQueryService.extractSandboxReason()`: example with the sample row from spec; empty LOG_MESSAGE; all-Good segments; multiple Bad segments (returns first)
- `PpLogQueryService.extractErrorReason()`: sample row with trailing meaningful segment; all-Good message; null message
- `XfcsStepperComponent.resetAll()`: verify signal state after call
- `XfcsStepperComponent.clearBlockLots()`: verify only target block cleared
- `buildNotFoundCsv()`: specific example with known lots

### Property-Based Tests

Uses **fast-check** (TypeScript/Angular) and **jqwik** (Java/Spring).

Each property test runs a minimum of **100 iterations**.

- **Property 1** — Tag: `Feature: stepper-pplog-enhancements, Property 1: resetAll clean state`
  Generate random environments, random arrays of SearchRows with random lots, random SearchResult arrays. Assert post-reset state invariant.

- **Property 2** — Tag: `Feature: stepper-pplog-enhancements, Property 2: clearBlockLots isolates`
  Generate random SearchRow arrays and a valid id. Assert only target block is cleared.

- **Property 3** — Tag: `Feature: stepper-pplog-enhancements, Property 3: lot stats computation`
  Generate random lot ID sets and random SearchResult arrays. Assert all three counts and the not-found set are computed correctly.

- **Property 4** — Tag: `Feature: stepper-pplog-enhancements, Property 4: CSV round-trip`
  Generate random lists of lot ID strings. Assert CSV line count and content.

- **Property 5** — Tag: `Feature: stepper-pplog-enhancements, Property 5: most-recent pp_log row`
  Generate random collections of simulated pp_log rows with varying dates. Assert returned row has max date.

- **Property 6** — Tag: `Feature: stepper-pplog-enhancements, Property 6: destination derivation`
  Generate random strings; generate strings that contain "sandbox", "NotProcessed", or neither. Assert derivation rules.

- **Property 7** — Tag: `Feature: stepper-pplog-enhancements, Property 7: sandbox reason extraction`
  Generate random LOG_MESSAGE strings with random segments. Assert first qualifying segment is returned.

- **Property 8** — Tag: `Feature: stepper-pplog-enhancements, Property 8: error reason extraction`
  Generate random LOG_MESSAGE strings with random segments. Assert last non-empty segment (or first with keyword) is returned.
