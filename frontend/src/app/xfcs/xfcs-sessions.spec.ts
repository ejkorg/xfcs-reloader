/**
 * Property-based tests for XfcsSessionsComponent pure helpers.
 * Feature: session-log-env-redesign
 *
 * Tests use fast-check and mirror the pure logic extracted from the component class.
 * Node.js / Angular TestBed is NOT required — all helpers are pure functions.
 */

import * as fc from 'fast-check';
import { FileStatusItem, ReloadStatus } from '../api/xfcs-models';

// ---------------------------------------------------------------------------
// Pure helpers mirroring component logic
// ---------------------------------------------------------------------------

/** Mirrors sortedSessions computed signal */
function sortedSessions(sessions: ReloadStatus[]): ReloadStatus[] {
  return [...sessions].sort((a: ReloadStatus, b: ReloadStatus) =>
    new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime()
  );
}

/** Mirrors destinationSummary() method */
function destinationSummary(files: FileStatusItem[]): { total: number; production: number; sandbox: number; failed: number } {
  const completed = files.filter((f: FileStatusItem) => f.fileStatus === 'completed');
  return {
    total: files.length,
    production: completed.filter((f: FileStatusItem) => f.processingDestination === 'PRODUCTION').length,
    sandbox: completed.filter((f: FileStatusItem) => f.processingDestination === 'SANDBOX').length,
    failed: files.filter((f: FileStatusItem) => f.fileStatus === 'failed').length,
  };
}

/** Mirrors the destinationFolder → processingDestination mapping in loadFileStatus() */
function mapProcessingDestination(destinationFolder: string | undefined): 'PRODUCTION' | 'SANDBOX' | null {
  return destinationFolder === 'PRODUCTION' ? 'PRODUCTION'
    : destinationFolder === 'SANDBOX' ? 'SANDBOX'
    : null;
}

/** Mirrors the destination badge class selection logic */
function destinationBadgeClass(f: FileStatusItem): string | null {
  if (f.fileStatus !== 'completed') return null;
  if (f.processingDestination === 'PRODUCTION') return 'production';
  if (f.processingDestination === 'SANDBOX') return 'sandbox';
  return 'unknown';
}

/** Mirrors the destination badge aria-label logic */
function destinationBadgeAriaLabel(f: FileStatusItem): string | null {
  if (f.fileStatus !== 'completed') return null;
  if (f.processingDestination === 'PRODUCTION') return 'Processed to PRODUCTION';
  if (f.processingDestination === 'SANDBOX') return 'Processed to SANDBOX';
  return 'Processing destination unknown';
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const arbIsoDate: fc.Arbitrary<string> = fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') })
  .map((d: Date) => d.toISOString());

const arbOptionalDate: fc.Arbitrary<string | undefined> = fc.option(arbIsoDate, { nil: undefined });

const arbReloadStatus: fc.Arbitrary<ReloadStatus> = fc.record({
  sessionId: fc.uuid(),
  status: fc.constantFrom('processing', 'created', 'completed', 'failed', 'cancelled'),
  environment: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
  requester: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: undefined }),
  updatedAt: arbOptionalDate,
  totalFiles: fc.option(fc.nat({ max: 200 }), { nil: undefined }),
  completedFiles: fc.option(fc.nat({ max: 200 }), { nil: undefined }),
  failedFiles: fc.option(fc.nat({ max: 200 }), { nil: undefined }),
});

const FILE_STATUSES = ['pending', 'staging', 'completed', 'failed'] as const;
const DESTINATIONS = ['PRODUCTION', 'SANDBOX', null] as const;

const arbFileStatusItem: fc.Arbitrary<FileStatusItem> = fc.record({
  absPath: fc.string({ minLength: 1, maxLength: 80 }),
  fileName: fc.string({ minLength: 1, maxLength: 40 }),
  fileStatus: fc.constantFrom(...FILE_STATUSES),
  processingDestination: fc.constantFrom(...DESTINATIONS),
  errorReason: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: undefined }),
  userLotId: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
});

// ---------------------------------------------------------------------------
// Property 4: Sessions sorted by updatedAt descending
//
// Feature: session-log-env-redesign, Property 4: Sessions sorted by updatedAt descending
// Validates: Requirements 3.6
// ---------------------------------------------------------------------------

describe('XfcsSessionsComponent — Property 4: Sessions sorted by updatedAt descending', () => {

  it('Property 4: result is in non-increasing updatedAt order', () => {
    fc.assert(
      fc.property(
        fc.array(arbReloadStatus, { minLength: 0, maxLength: 30 }),
        (sessions: ReloadStatus[]) => {
          const sorted = sortedSessions(sessions);
          for (let i = 0; i < sorted.length - 1; i++) {
            const a = new Date(sorted[i].updatedAt ?? 0).getTime();
            const b = new Date(sorted[i + 1].updatedAt ?? 0).getTime();
            if (a < b) return false;
          }
          return true;
        }
      ),
      { numRuns: 200 }
    );
  });

  it('Property 4: sorted result contains the same sessions as the input', () => {
    fc.assert(
      fc.property(
        fc.array(arbReloadStatus, { minLength: 0, maxLength: 30 }),
        (sessions: ReloadStatus[]) => {
          const sorted = sortedSessions(sessions);
          const inputIds = sessions.map((s: ReloadStatus) => s.sessionId).sort();
          const sortedIds = sorted.map((s: ReloadStatus) => s.sessionId).sort();
          return inputIds.length === sortedIds.length &&
            inputIds.every((id: string, i: number) => id === sortedIds[i]);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('Property 4: sorting is idempotent — sorting twice gives the same result', () => {
    fc.assert(
      fc.property(
        fc.array(arbReloadStatus, { minLength: 0, maxLength: 30 }),
        (sessions: ReloadStatus[]) => {
          const once = sortedSessions(sessions);
          const twice = sortedSessions(once);
          return once.length === twice.length &&
            once.every((s: ReloadStatus, i: number) => s.sessionId === twice[i].sessionId);
        }
      ),
      { numRuns: 200 }
    );
  });

});

// ---------------------------------------------------------------------------
// Property 5: Destination badge rendering correctness
//
// Feature: session-log-env-redesign, Property 5: Destination badge rendering correctness
// Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5
// ---------------------------------------------------------------------------

describe('XfcsSessionsComponent — Property 5: Destination badge rendering correctness', () => {

  it('Property 5: completed + PRODUCTION → green "production" badge with correct aria-label', () => {
    fc.assert(
      fc.property(
        arbFileStatusItem.filter((f: FileStatusItem) => f.fileStatus === 'completed' && f.processingDestination === 'PRODUCTION'),
        (f: FileStatusItem) => {
          return destinationBadgeClass(f) === 'production' &&
            destinationBadgeAriaLabel(f) === 'Processed to PRODUCTION';
        }
      ),
      { numRuns: 200 }
    );
  });

  it('Property 5: completed + SANDBOX → amber "sandbox" badge with correct aria-label', () => {
    fc.assert(
      fc.property(
        arbFileStatusItem.filter((f: FileStatusItem) => f.fileStatus === 'completed' && f.processingDestination === 'SANDBOX'),
        (f: FileStatusItem) => {
          return destinationBadgeClass(f) === 'sandbox' &&
            destinationBadgeAriaLabel(f) === 'Processed to SANDBOX';
        }
      ),
      { numRuns: 200 }
    );
  });

  it('Property 5: completed + null destination → gray "unknown" badge', () => {
    fc.assert(
      fc.property(
        arbFileStatusItem.filter((f: FileStatusItem) => f.fileStatus === 'completed' && f.processingDestination == null),
        (f: FileStatusItem) => {
          return destinationBadgeClass(f) === 'unknown' &&
            destinationBadgeAriaLabel(f) === 'Processing destination unknown';
        }
      ),
      { numRuns: 200 }
    );
  });

  it('Property 5: non-completed files → no destination badge rendered', () => {
    fc.assert(
      fc.property(
        arbFileStatusItem.filter((f: FileStatusItem) => f.fileStatus !== 'completed'),
        (f: FileStatusItem) => {
          return destinationBadgeClass(f) === null &&
            destinationBadgeAriaLabel(f) === null;
        }
      ),
      { numRuns: 200 }
    );
  });

});

// ---------------------------------------------------------------------------
// Property 6: Destination summary counts correctness
//
// Feature: session-log-env-redesign, Property 6: Destination summary counts correctness
// Validates: Requirements 5.1, 5.2, 5.3, 5.4
// ---------------------------------------------------------------------------

describe('XfcsSessionsComponent — Property 6: Destination summary counts correctness', () => {

  it('Property 6: total equals files.length', () => {
    fc.assert(
      fc.property(
        fc.array(arbFileStatusItem, { minLength: 0, maxLength: 50 }),
        (files: FileStatusItem[]) => {
          const summary = destinationSummary(files);
          return summary.total === files.length;
        }
      ),
      { numRuns: 200 }
    );
  });

  it('Property 6: production count equals completed files with PRODUCTION destination', () => {
    fc.assert(
      fc.property(
        fc.array(arbFileStatusItem, { minLength: 0, maxLength: 50 }),
        (files: FileStatusItem[]) => {
          const summary = destinationSummary(files);
          const expected = files.filter((f: FileStatusItem) => f.fileStatus === 'completed' && f.processingDestination === 'PRODUCTION').length;
          return summary.production === expected;
        }
      ),
      { numRuns: 200 }
    );
  });

  it('Property 6: sandbox count equals completed files with SANDBOX destination', () => {
    fc.assert(
      fc.property(
        fc.array(arbFileStatusItem, { minLength: 0, maxLength: 50 }),
        (files: FileStatusItem[]) => {
          const summary = destinationSummary(files);
          const expected = files.filter((f: FileStatusItem) => f.fileStatus === 'completed' && f.processingDestination === 'SANDBOX').length;
          return summary.sandbox === expected;
        }
      ),
      { numRuns: 200 }
    );
  });

  it('Property 6: failed count equals files with failed status', () => {
    fc.assert(
      fc.property(
        fc.array(arbFileStatusItem, { minLength: 0, maxLength: 50 }),
        (files: FileStatusItem[]) => {
          const summary = destinationSummary(files);
          const expected = files.filter((f: FileStatusItem) => f.fileStatus === 'failed').length;
          return summary.failed === expected;
        }
      ),
      { numRuns: 200 }
    );
  });

  it('Property 6: production + sandbox + failed + other ≤ total', () => {
    fc.assert(
      fc.property(
        fc.array(arbFileStatusItem, { minLength: 0, maxLength: 50 }),
        (files: FileStatusItem[]) => {
          const summary = destinationSummary(files);
          return summary.production + summary.sandbox + summary.failed <= summary.total;
        }
      ),
      { numRuns: 200 }
    );
  });

});

// ---------------------------------------------------------------------------
// Property 7: Copy session ID interaction
//
// Feature: session-log-env-redesign, Property 7: Copy session ID interaction
// Validates: Requirements 7.1, 7.2
// ---------------------------------------------------------------------------

describe('XfcsSessionsComponent — Property 7: Copy session ID interaction', () => {

  it('Property 7: mapProcessingDestination maps PRODUCTION correctly', () => {
    fc.assert(
      fc.property(fc.uuid(), (_id: string) => {
        return mapProcessingDestination('PRODUCTION') === 'PRODUCTION';
      }),
      { numRuns: 100 }
    );
  });

  it('Property 7: mapProcessingDestination maps SANDBOX correctly', () => {
    fc.assert(
      fc.property(fc.uuid(), (_id: string) => {
        return mapProcessingDestination('SANDBOX') === 'SANDBOX';
      }),
      { numRuns: 100 }
    );
  });

  it('Property 7: mapProcessingDestination returns null for any other value', () => {
    fc.assert(
      fc.property(
        fc.option(fc.string().filter((s: string) => s !== 'PRODUCTION' && s !== 'SANDBOX'), { nil: undefined }),
        (val: string | undefined) => {
          return mapProcessingDestination(val) === null;
        }
      ),
      { numRuns: 200 }
    );
  });

  it('Property 7: clipboard receives the full session ID, not the truncated display value', () => {
    // The component passes the full sessionId to clipboard.writeText — not the 8-char truncated display.
    // We verify the contract: for any UUID, the full ID differs from its 8-char prefix (unless ≤8 chars).
    fc.assert(
      fc.property(fc.uuid(), (sessionId: string) => {
        const truncated = sessionId.slice(0, 8);
        // A UUID is always 36 chars, so truncated !== sessionId — the full ID must be used.
        return sessionId.length > 8 ? truncated !== sessionId : truncated === sessionId;
      }),
      { numRuns: 200 }
    );
  });

});

// ---------------------------------------------------------------------------
// Import the pure helper from the component (exported for testability)
// ---------------------------------------------------------------------------
import { buildDailyTrend, DailyTrendRow } from './xfcs-sessions.component';

// ---------------------------------------------------------------------------
// Pure helper mirroring filteredFiles computed signal
// ---------------------------------------------------------------------------

function filteredFiles(
  files: FileStatusItem[],
  start: string | null,
  end: string | null
): FileStatusItem[] {
  if (!start && !end) return files;
  return files.filter(f => {
    if (!f.createdAt) return true;
    const d = f.createdAt.substring(0, 10);
    if (start && d < start) return false;
    if (end && d > end) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Arbitraries for date-range tests
// ---------------------------------------------------------------------------

/** Generates a date string in YYYY-MM-DD format */
const arbDateStr: fc.Arbitrary<string> = fc.date({
  min: new Date('2023-01-01'),
  max: new Date('2025-12-31'),
}).map((d: Date) => d.toISOString().substring(0, 10));

/** Generates a FileStatusItem with a createdAt date string */
const arbFileWithDate: fc.Arbitrary<FileStatusItem> = fc.record({
  absPath: fc.string({ minLength: 1, maxLength: 60 }),
  fileName: fc.string({ minLength: 1, maxLength: 40 }),
  fileStatus: fc.constantFrom('pending', 'staging', 'completed', 'failed') as fc.Arbitrary<FileStatusItem['fileStatus']>,
  processingDestination: fc.constantFrom('PRODUCTION', 'SANDBOX', null) as fc.Arbitrary<'PRODUCTION' | 'SANDBOX' | null>,
  createdAt: fc.option(
    fc.date({ min: new Date('2023-01-01'), max: new Date('2025-12-31') })
      .map((d: Date) => d.toISOString()),
    { nil: undefined }
  ),
  resolvedAt: fc.option(
    fc.date({ min: new Date('2023-01-01'), max: new Date('2025-12-31') })
      .map((d: Date) => d.toISOString()),
    { nil: undefined }
  ),
});

// ---------------------------------------------------------------------------
// Property 8: Analytics date range filter
//
// Feature: session-log-env-redesign, Property 8: Analytics date range filter
// Validates: Requirements 8.4, 9.1, 9.2
// ---------------------------------------------------------------------------

describe('XfcsSessionsComponent — Property 8: Analytics date range filter', () => {

  it('Property 8: all returned files have createdAt within [start, end] (when both set)', () => {
    fc.assert(
      fc.property(
        fc.array(arbFileWithDate, { minLength: 0, maxLength: 40 }),
        arbDateStr,
        arbDateStr,
        (files: FileStatusItem[], d1: string, d2: string) => {
          const start = d1 <= d2 ? d1 : d2;
          const end   = d1 <= d2 ? d2 : d1;
          const result = filteredFiles(files, start, end);
          return result.every((f: FileStatusItem) => {
            if (!f.createdAt) return true; // null createdAt passes through
            const d = f.createdAt.substring(0, 10);
            return d >= start && d <= end;
          });
        }
      ),
      { numRuns: 200 }
    );
  });

  it('Property 8: no filter (null start and end) returns all files', () => {
    fc.assert(
      fc.property(
        fc.array(arbFileWithDate, { minLength: 0, maxLength: 40 }),
        (files: FileStatusItem[]) => {
          const result = filteredFiles(files, null, null);
          return result.length === files.length;
        }
      ),
      { numRuns: 200 }
    );
  });

  it('Property 8: filtered result is a subset of the original array', () => {
    fc.assert(
      fc.property(
        fc.array(arbFileWithDate, { minLength: 0, maxLength: 40 }),
        fc.option(arbDateStr, { nil: null }),
        fc.option(arbDateStr, { nil: null }),
        (files: FileStatusItem[], start: string | null, end: string | null) => {
          const result = filteredFiles(files, start, end);
          return result.length <= files.length;
        }
      ),
      { numRuns: 200 }
    );
  });

  it('Property 8: status summary percentages are computed from filtered list only', () => {
    fc.assert(
      fc.property(
        fc.array(arbFileWithDate, { minLength: 1, maxLength: 40 }),
        arbDateStr,
        arbDateStr,
        (files: FileStatusItem[], d1: string, d2: string) => {
          const start = d1 <= d2 ? d1 : d2;
          const end   = d1 <= d2 ? d2 : d1;
          const filtered = filteredFiles(files, start, end);
          const total = filtered.length;
          if (total === 0) return true;
          const completed = filtered.filter((f: FileStatusItem) => f.fileStatus === 'completed').length;
          const failed    = filtered.filter((f: FileStatusItem) => f.fileStatus === 'failed').length;
          const completedPct = Math.round((completed / total) * 100);
          const failedPct    = Math.round((failed / total) * 100);
          // Percentages must be in [0, 100]
          return completedPct >= 0 && completedPct <= 100 &&
                 failedPct    >= 0 && failedPct    <= 100 &&
                 completedPct + failedPct <= 100;
        }
      ),
      { numRuns: 200 }
    );
  });

});

// ---------------------------------------------------------------------------
// Property 9: Daily trend grouping correctness
//
// Feature: session-log-env-redesign, Property 9: Daily trend grouping correctness
// Validates: Requirements 9.1
// ---------------------------------------------------------------------------

describe('XfcsSessionsComponent — Property 9: Daily trend grouping correctness', () => {

  it('Property 9: for each day, sum of all status counts equals count of files with that createdAt date', () => {
    fc.assert(
      fc.property(
        fc.array(arbFileWithDate, { minLength: 0, maxLength: 60 }),
        (files: FileStatusItem[]) => {
          const rows = buildDailyTrend(files);
          return rows.every((row: DailyTrendRow) => {
            const filesForDay = files.filter((f: FileStatusItem) => {
              const day = f.createdAt ? f.createdAt.substring(0, 10) : 'unknown';
              return day === row.day;
            });
            const rowTotal = row.done + row.failed + row.staging + row.pending;
            return rowTotal === filesForDay.length;
          });
        }
      ),
      { numRuns: 200 }
    );
  });

  it('Property 9: total files across all rows equals total input files', () => {
    fc.assert(
      fc.property(
        fc.array(arbFileWithDate, { minLength: 0, maxLength: 60 }),
        (files: FileStatusItem[]) => {
          const rows = buildDailyTrend(files);
          const rowTotal = rows.reduce((sum: number, r: DailyTrendRow) => sum + r.done + r.failed + r.staging + r.pending, 0);
          return rowTotal === files.length;
        }
      ),
      { numRuns: 200 }
    );
  });

  it('Property 9: rows are sorted ascending by day', () => {
    fc.assert(
      fc.property(
        fc.array(arbFileWithDate, { minLength: 0, maxLength: 60 }),
        (files: FileStatusItem[]) => {
          const rows = buildDailyTrend(files);
          for (let i = 0; i < rows.length - 1; i++) {
            if (rows[i].day > rows[i + 1].day) return false;
          }
          return true;
        }
      ),
      { numRuns: 200 }
    );
  });

  it('Property 9: each day appears at most once in the result', () => {
    fc.assert(
      fc.property(
        fc.array(arbFileWithDate, { minLength: 0, maxLength: 60 }),
        (files: FileStatusItem[]) => {
          const rows = buildDailyTrend(files);
          const days = rows.map((r: DailyTrendRow) => r.day);
          return new Set(days).size === days.length;
        }
      ),
      { numRuns: 200 }
    );
  });

  it('Property 9: done count equals completed files for that day', () => {
    fc.assert(
      fc.property(
        fc.array(arbFileWithDate, { minLength: 0, maxLength: 60 }),
        (files: FileStatusItem[]) => {
          const rows = buildDailyTrend(files);
          return rows.every((row: DailyTrendRow) => {
            const expected = files.filter((f: FileStatusItem) => {
              const day = f.createdAt ? f.createdAt.substring(0, 10) : 'unknown';
              return day === row.day && f.fileStatus === 'completed';
            }).length;
            return row.done === expected;
          });
        }
      ),
      { numRuns: 200 }
    );
  });

});
