# Design Document: Lot Exensio Pre-Check

## Overview

Before advancing from Step 1 to Step 2, the stepper now runs an Exensio pre-check. It sends all entered lot IDs (with the selected environment and year/month criteria) to a new backend endpoint, which queries Exensio's raw-SQL API to see whether those lots already have processed records. If any are found, a modal warning is shown so the user can decide whether to continue or go back. All results can be exported to CSV client-side.

The feature spans:
- A new backend endpoint `POST /api/xfcs/lots/exensio-precheck`
- A new `ExensioPreCheckService` in the xfcs-reloader backend
- Frontend changes to `XfcsStepperComponent` (pre-check call, loading state, stale tracking)
- A new inline `ExensioPreCheckDialogComponent` (modal warning + CSV export)

---

## Architecture

```
XfcsStepperComponent
  On "Search Archive →" click:
    1. Build PreCheckRequest from searchRows + environment
    2. Call XfcsApiService.runExensioPreCheck(req)      ← new API method
    3. Show "Checking Exensio…" overlay
    4. On response:
       - lotsFound empty  → proceed to performSearch()
       - lotsFound non-empty → open ExensioPreCheckDialogComponent
         - "Proceed Anyway" → performSearch()
         - "Go Back"        → stay on Step 1
       - error/failure → log warning, proceed to performSearch()

Backend (XfcsController + ExensioPreCheckService):
    POST /api/xfcs/lots/exensio-precheck
      → ExensioPreCheckService.check(request)
        → build Oracle SQL with lot IN (...) + optional date range
        → POST /v1/key/raw-sql  (Exensio API, via ExensioAuthService)
        → parse rows, partition into lotsFound / lotsNotFound
        → return ExensioPreCheckResponse
```

---

## Components and Interfaces

### Backend

#### `ExensioPreCheckRequest` (DTO)
```java
public record ExensioPreCheckRequest(
    String environment,
    List<String> lotIds,           // flat deduplicated list
    List<PreCheckBlock> blocks     // optional, for date-range filtering
) {}

public record PreCheckBlock(
    Integer year,
    Integer month,
    List<String> lots
) {}
```

#### `ExensioPreCheckResponse` (DTO)
```java
public record ExensioPreCheckResponse(
    List<String> lotsFound,
    List<String> lotsNotFound,
    List<ExensioPreCheckRow> rows,
    String error                   // null on success; set on soft failure
) {}

public record ExensioPreCheckRow(
    String lotId,
    String endTime,   // ISO-8601 string: "2025-03-14T08:22:11Z"
    String ppid,
    String waferId,
    int    pgcKey     // 1=Sort, 2=FT, 4=BinMap/WaferMap, 5=PCM
) {}
```

#### `ExensioPreCheckService`
New `@Service` in `xfcs-reloader/backend/.../service/`.

Key method:
```java
public ExensioPreCheckResponse check(ExensioPreCheckRequest request) {
    // 1. Get Exensio token via ExensioAuthService
    // 2. Build SQL (see Query Design section)
    // 3. POST to /v1/key/raw-sql with retry on 401
    // 4. Parse JSON rows
    // 5. Partition lot IDs into found / not-found
    // 6. Return ExensioPreCheckResponse
}
```

Error handling:
- On 401 → invalidate token, re-login once, retry
- On network error / 5xx → return `ExensioPreCheckResponse` with `error` field set, empty lists

#### `XfcsController` addition
```java
@PostMapping("/lots/exensio-precheck")
public ExensioPreCheckResponse exensioPreCheck(@RequestBody ExensioPreCheckRequest request) {
    assertFeatureEnabled();
    return exensioPreCheckService.check(request);
}
```

---

### Frontend

#### `XfcsApiService` addition
```typescript
runExensioPreCheck(req: ExensioPreCheckRequest): Observable<ExensioPreCheckResponse> {
  return this.http.post<ExensioPreCheckResponse>(
    `${this.base}/lots/exensio-precheck`, req,
    { headers: this.auth.getAuthHeaders() ?? undefined }
  );
}
```

#### New TypeScript models (in `xfcs-models.ts`)
```typescript
export interface ExensioPreCheckRequest {
  environment: string;
  lotIds: string[];
  blocks?: { year?: number; month?: number; lots: string[] }[];
}

export interface ExensioPreCheckRow {
  lotId: string;
  endTime: string;
  ppid: string;
  waferId: string;
}

export interface ExensioPreCheckResponse {
  lotsFound: string[];
  lotsNotFound: string[];
  rows: ExensioPreCheckRow[];
  error?: string;
}
```

#### `XfcsStepperComponent` changes

New signals:
```typescript
preChecking      = signal<boolean>(false);
preCheckResult   = signal<ExensioPreCheckResponse | null>(null);
preCheckStale    = signal<boolean>(false);
showPreCheckDlg  = signal<boolean>(false);
preCheckEnabled  = signal<boolean>(true);   // toggled by the UI checkbox
```

The `preCheckEnabled` signal is initialised from `localStorage`:
```typescript
private readonly PRECHECK_STORAGE_KEY = 'xfcs.precheck.enabled';

// in constructor / ngOnInit:
const stored = localStorage.getItem(this.PRECHECK_STORAGE_KEY);
this.preCheckEnabled.set(stored === null ? true : stored === 'true');

// whenever the checkbox changes:
onPreCheckToggle(enabled: boolean): void {
  this.preCheckEnabled.set(enabled);
  localStorage.setItem(this.PRECHECK_STORAGE_KEY, String(enabled));
}
```

Updated `onSearchClick()` flow:
```typescript
async onSearchClick(): Promise<void> {
  if (!this.canSearch()) return;

  // Skip pre-check entirely when toggle is off
  if (!this.preCheckEnabled()) {
    this.performSearch();
    return;
  }

  this.preChecking.set(true);
  try {
    const req = this.buildPreCheckRequest();
    const result = await firstValueFrom(
      this.api.runExensioPreCheck(req).pipe(catchError(() => of(null)))
    );
    this.preCheckResult.set(result);
    this.preCheckStale.set(false);
    if (result && !result.error && result.lotsFound.length > 0) {
      this.showPreCheckDlg.set(true);
      return; // wait for user decision in dialog
    }
  } catch {
    // soft failure — proceed
  } finally {
    this.preChecking.set(false);
  }
  this.performSearch();
}

buildPreCheckRequest(): ExensioPreCheckRequest {
  const allLots = new Set<string>();
  const blocks = this.searchRows().map(row => {
    row.lots.forEach(l => allLots.add(l));
    return { year: row.year, month: row.month, lots: [...row.lots] };
  });
  return {
    environment: this.environment(),
    lotIds: [...allLots],
    blocks
  };
}
```

Updated `resetAll()`:
```typescript
this.preCheckResult.set(null);
this.preCheckStale.set(false);
this.showPreCheckDlg.set(false);
```

Stale tracking — call `preCheckStale.set(true)` inside `updateRow()` and `removeLot()` when a pre-check result exists.

Template changes in Step 1:
- Replace `(clicked)="performSearch()"` on the Search button with `(clicked)="onSearchClick()"`
- Replace `[loading]="searching()"` with `[loading]="searching() || preChecking()"`
- Add loading message: `{{ preChecking() ? 'Checking Exensio…' : 'Searching Archives…' }}`
- Add a checkbox near the Search button: `<input type="checkbox" [checked]="preCheckEnabled()" (change)="onPreCheckToggle($event.target.checked)"> Check Exensio before searching`
- Add `<app-exensio-precheck-dialog>` overlay when `showPreCheckDlg()` is true

#### `ExensioPreCheckDialogComponent` (new standalone component)

```typescript
@Component({
  selector: 'app-exensio-precheck-dialog',
  standalone: true,
  ...
})
export class ExensioPreCheckDialogComponent {
  @Input() result!: ExensioPreCheckResponse;
  @Input() environment!: string;
  @Output() proceed = new EventEmitter<void>();
  @Output() goBack  = new EventEmitter<void>();

  exportCsv(): void { /* see CSV Export section */ }
}
```

Template (inline panel overlay, not Angular Material dialog):
- Header: "⚠ Lots Found in Exensio"
- Summary: "X of Y lots already found in Exensio"
- Table: lot_id | end_time | ppid | wafer_id (scrollable, max 400px height)
- Buttons: "Export CSV" (secondary), "Go Back" (secondary), "Proceed Anyway" (primary/warning)

---

## Data Models

All new models are additions to existing files — no new model files required.

Backend DTOs live in:
`xfcs-reloader/backend/.../web/dto/ExensioPreCheckRequest.java`
`xfcs-reloader/backend/.../web/dto/ExensioPreCheckResponse.java`
`xfcs-reloader/backend/.../web/dto/ExensioPreCheckRow.java`

Frontend models added to `xfcs-models.ts`.

---

## Query Design

### SQL Template (backend `ExensioPreCheckService.buildSql()`)

```sql
SELECT * FROM (
  SELECT
    l.lot_id                                                          AS lot_id,
    NVL(TO_CHAR(ol.end_time,'YYYY-MM-DD"T"HH24:MI:SS"Z"'), '')      AS end_time,
    NVL(p.ppid, '')                                                   AS ppid,
    NVL(w.wf_id, '')                                                  AS wafer_id
  FROM op_log ol
  JOIN lot      l   ON l.lot_key   = ol.lot_key
  JOIN program  p   ON p.pg_key    = ol.pg_key
  LEFT JOIN wf_log  wfl ON wfl.lg_key = ol.lg_key
  LEFT JOIN wafer   w   ON w.wf_key   = wfl.wf_key
  WHERE UPPER(TRIM(l.lot_id)) IN (
      UPPER('LOT1'), UPPER('LOT2'), ...
  )
  /* Date range clause — added when year is provided (year-only): */
  AND TRUNC(ol.end_time) >= TO_DATE('<year>-01-01','YYYY-MM-DD')
  AND TRUNC(ol.end_time) <  TO_DATE('<year+1>-01-01','YYYY-MM-DD')
  /* If year + month both provided, use instead: */
  -- AND TRUNC(ol.end_time) >= TO_DATE('<year>-<MM>-01','YYYY-MM-DD')
  -- AND TRUNC(ol.end_time) <  ADD_MONTHS(TO_DATE('<year>-<MM>-01','YYYY-MM-DD'), 1)

  ORDER BY l.lot_id, ol.end_time DESC
) WHERE ROWNUM <= 10000
```

Notes:
- Lot literals are SQL-escaped (single-quote doubling).
- When multiple blocks with different year/month combinations exist, the service builds one query per unique (year, month) combination and unions the results, or — simpler — builds a single query with an `OR`-combined date range across all blocks.
- The `pgc_key` filter is intentionally omitted — we want to catch any record type.
- The `wf_log` / `wafer` join uses `LEFT JOIN` so lots without wafer records are still returned.

### Date range helper (Java)

```java
// year only
"TRUNC(ol.end_time) >= TO_DATE('" + year + "-01-01','YYYY-MM-DD') " +
"AND TRUNC(ol.end_time) < TO_DATE('" + (year + 1) + "-01-01','YYYY-MM-DD')"

// year + month
String monthStr = String.format("%02d", month);
"TRUNC(ol.end_time) >= TO_DATE('" + year + "-" + monthStr + "-01','YYYY-MM-DD') " +
"AND TRUNC(ol.end_time) < ADD_MONTHS(TO_DATE('" + year + "-" + monthStr + "-01','YYYY-MM-DD'), 1)"
```

### Response parsing (Java)

Exensio raw-SQL response format:
```json
{ "rows": [ { "LOT_ID": "...", "END_TIME": "...", "PPID": "...", "WAFER_ID": "..." }, ... ] }
```

Partition logic:
```java
Set<String> submittedUpper = request.lotIds().stream()
    .map(String::toUpperCase).collect(toSet());
Set<String> foundUpper = rows.stream()
    .map(r -> r.lotId().toUpperCase()).collect(toSet());
List<String> lotsFound    = request.lotIds().stream()
    .filter(l -> foundUpper.contains(l.toUpperCase())).toList();
List<String> lotsNotFound = request.lotIds().stream()
    .filter(l -> !foundUpper.contains(l.toUpperCase())).toList();
```

---

## CSV Export

Client-side in `ExensioPreCheckDialogComponent.exportCsv()`:

```typescript
exportCsv(): void {
  const header = 'lot_id,end_time,ppid,wafer_id\n';
  const body = this.result.rows
    .map(r => [r.lotId, r.endTime, r.ppid, r.waferId]
      .map(v => '"' + (v ?? '').replace(/"/g, '""') + '"')
      .join(','))
    .join('\n');
  const blob = new Blob([header + body], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const ts   = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `exensio-precheck-${this.environment}-${ts}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
```

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Pre-check request contains all deduplicated lot IDs

*For any* set of `SearchRow[]` entries (possibly with overlapping lot IDs), `buildPreCheckRequest()` SHALL return a `lotIds` array that is the deduplicated union of all `row.lots` arrays, with no duplicates and no omissions.

**Validates: Requirements 1.2**

---

### Property 2: SQL IN clause contains every submitted lot ID

*For any* non-empty list of lot IDs, `ExensioPreCheckService.buildSql()` SHALL produce a SQL string that contains an `IN (...)` clause including every submitted lot ID, properly single-quote-escaped.

**Validates: Requirements 2.2, 6.2**

---

### Property 3: Year-only date filter produces correct boundary dates

*For any* integer year Y, the SQL produced by `buildSql()` with `year=Y, month=null` SHALL contain a date range that starts on `Y-01-01` (inclusive) and ends strictly before `(Y+1)-01-01`.

**Validates: Requirements 2.3, 6.3**

---

### Property 4: Year+month date filter uses ADD_MONTHS boundary

*For any* valid (year, month) pair, the SQL produced by `buildSql()` with both set SHALL contain a range starting on the first of that month and ending with `ADD_MONTHS(..., 1)` for the upper bound.

**Validates: Requirements 2.3, 6.4**

---

### Property 5: Response partitioning is a complete, non-overlapping cover

*For any* pre-check request with N lot IDs and any Exensio response, `lotsFound ∪ lotsNotFound` SHALL equal the set of all submitted lot IDs, and `lotsFound ∩ lotsNotFound` SHALL be empty.

**Validates: Requirements 2.5**

---

### Property 6: Row limit is applied in generated SQL

*For any* configured `precheck-row-limit` value L, the SQL produced by `buildSql()` SHALL contain `ROWNUM <= L`.

**Validates: Requirements 6.5**

---

### Property 7: CSV row count equals pre-check rows count

*For any* `ExensioPreCheckResponse` with N rows, the CSV output of `exportCsv()` SHALL contain exactly N+1 lines (1 header + N data rows).

**Validates: Requirements 4.3**

---

### Property 8: CSV output contains all required columns in the header

*For any* call to `exportCsv()`, the first line of the CSV output SHALL contain exactly `lot_id,end_time,ppid,wafer_id`.

**Validates: Requirements 4.2**

---

### Property 9: Reset clears pre-check state

*For any* stepper state with a non-null `preCheckResult`, calling `resetAll()` SHALL set `preCheckResult` to `null` and `preCheckStale` to `false`.

**Validates: Requirements 5.1**

---

### Property 10: Mutation marks pre-check result as stale

*For any* stepper state where `preCheckResult` is non-null, modifying any lot ID or year/month in any `SearchRow` SHALL set `preCheckStale` to `true`.

**Validates: Requirements 5.2**

---

### Property 11: Dialog shows correct count summary

*For any* `ExensioPreCheckResponse` with F found lots out of T total submitted lots, the rendered dialog SHALL contain the text `F of T lots already found in Exensio`.

**Validates: Requirements 3.3**

---

### Property 12: Pre-check skipped when toggle is disabled

*For any* stepper state where `preCheckEnabled` is `false`, calling `onSearchClick()` SHALL call `performSearch()` directly without setting `preChecking` to `true` or invoking the pre-check API.

**Validates: Requirements 5.3**

---

### Property 13: Toggle state persisted to localStorage

*For any* boolean value passed to `onPreCheckToggle()`, `localStorage.getItem('xfcs.precheck.enabled')` SHALL equal the string representation of that value after the call.

**Validates: Requirements 5.4**

---

## Error Handling

| Scenario | Backend behavior | Frontend behavior |
|---|---|---|
| Exensio returns HTTP 401 | Invalidate token, re-login once, retry | Transparent |
| Exensio returns HTTP 429 / 5xx | Return 200 with `error` field | Log warning, proceed to archive search |
| Network timeout / unreachable | Return 200 with `error` field | Log warning, proceed to archive search |
| Empty lot IDs list | Return 200 with empty lists, no SQL called | Pre-check skipped (canSearch guard prevents this) |
| All lots not found | `lotsFound=[]`, `lotsNotFound=[all]` | No dialog; proceed to archive search |
| SQL injection attempt in lot ID | Single-quote escaping in SQL builder prevents injection | N/A |

---

## Testing Strategy

### Unit Tests

- `buildPreCheckRequest()` deduplicates lots across multiple rows
- `buildSql()` generates correct IN clause for various lot lists
- `buildSql()` omits date clause when year is null
- `buildSql()` generates year-only range correctly
- `buildSql()` generates year+month ADD_MONTHS range correctly
- `parseResponse()` correctly partitions found/not-found
- `exportCsv()` generates header + N body rows
- `exportCsv()` escapes double-quotes in values
- `resetAll()` sets preCheckResult to null

### Property-Based Tests

Uses **fast-check** (TypeScript) and **JUnit + standard Java** for backend. Each property test runs a minimum of 100 iterations.

- **Property 1** — Tag: `Feature: lot-exensio-precheck, Property 1: pre-check request deduplication`
  Generate random `SearchRow[]` with overlapping lots. Assert `buildPreCheckRequest().lotIds` has no duplicates and contains every lot.

- **Property 2** — Tag: `Feature: lot-exensio-precheck, Property 2: SQL IN clause completeness`
  Generate random lot ID arrays (with special characters). Assert every lot appears in the IN clause of the generated SQL, properly escaped.

- **Property 3** — Tag: `Feature: lot-exensio-precheck, Property 3: year-only date filter boundaries`
  Generate random years 2000–2099. Assert SQL contains `Y-01-01` lower bound and `(Y+1)-01-01` upper bound.

- **Property 4** — Tag: `Feature: lot-exensio-precheck, Property 4: year+month ADD_MONTHS filter`
  Generate random (year, month) pairs. Assert SQL contains ADD_MONTHS clause.

- **Property 5** — Tag: `Feature: lot-exensio-precheck, Property 5: response partitioning covers all lots`
  Generate random lot lists and random Exensio row sets. Assert lotsFound ∪ lotsNotFound = submitted lots, intersection empty.

- **Property 6** — Tag: `Feature: lot-exensio-precheck, Property 6: row limit in SQL`
  Generate random row limit values. Assert SQL contains `ROWNUM <= <limit>`.

- **Property 7** — Tag: `Feature: lot-exensio-precheck, Property 7: CSV row count`
  Generate random ExensioPreCheckRow arrays of length N. Assert CSV has N+1 lines.

- **Property 8** — Tag: `Feature: lot-exensio-precheck, Property 8: CSV header columns`
  For any rows input, assert first CSV line equals `lot_id,end_time,ppid,wafer_id`.

- **Property 9** — Tag: `Feature: lot-exensio-precheck, Property 9: reset clears state`
  Generate any non-null preCheckResult state. Call resetAll(). Assert preCheckResult is null.

- **Property 10** — Tag: `Feature: lot-exensio-precheck, Property 10: mutation marks stale`
  Generate any stepper state with non-null preCheckResult. Mutate a SearchRow. Assert preCheckStale is true.

- **Property 11** — Tag: `Feature: lot-exensio-precheck, Property 11: dialog count summary`
  Generate random (lotsFound, totalLots) pairs. Assert rendered summary contains correct F and T values.

- **Property 12** — Tag: `Feature: lot-exensio-precheck, Property 12: pre-check skipped when disabled`
  Set `preCheckEnabled` to false, call `onSearchClick()`. Assert `preChecking` was never set to true and the API was not called.

- **Property 13** — Tag: `Feature: lot-exensio-precheck, Property 13: toggle persisted to localStorage`
  Generate random boolean values. Call `onPreCheckToggle(value)`. Assert `localStorage.getItem('xfcs.precheck.enabled') === String(value)`.
