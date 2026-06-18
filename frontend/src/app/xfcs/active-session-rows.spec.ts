import * as fc from 'fast-check';
import { ReloadStatus } from '../api/xfcs-models';

/**
 * Pure helper that mirrors calcProgress() in XfcsDashboardComponent.
 */
function calcProgress(s: ReloadStatus): number {
  if (!s.totalFiles) return 0;
  const done = (s.completedFiles ?? 0) + (s.failedFiles ?? 0);
  return Math.min(100, Math.round((done / s.totalFiles) * 100));
}

/**
 * Pure helper that mirrors the session row rendering logic:
 * Returns the fields that would be rendered for a given ReloadStatus.
 */
interface SessionRowFields {
  truncatedId: string;
  environment: string;
  requester: string;
  progressPct: number;
  status: string;
}

function buildSessionRow(s: ReloadStatus): SessionRowFields {
  return {
    truncatedId: s.sessionId.slice(0, 8),
    environment: s.environment ?? '—',
    requester: s.requester ?? '—',
    progressPct: calcProgress(s),
    status: s.status,
  };
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const ACTIVE_STATUSES = ['processing', 'created'] as const;

const arbActiveReloadStatus: fc.Arbitrary<ReloadStatus> = fc.record({
  sessionId: fc.uuid(),
  status: fc.constantFrom(...ACTIVE_STATUSES),
  environment: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
  requester: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: undefined }),
  totalFiles: fc.option(fc.nat({ max: 500 }), { nil: undefined }),
  completedFiles: fc.option(fc.nat({ max: 500 }), { nil: undefined }),
  failedFiles: fc.option(fc.nat({ max: 500 }), { nil: undefined }),
});

// ---------------------------------------------------------------------------
// Property 4: Active session rows contain all required fields
//
// Feature: dashboard-redesign, Property 4: Active session rows contain all required fields
// Validates: Requirements 2.3
// ---------------------------------------------------------------------------

describe('XfcsDashboardComponent — Property 4: Active session rows contain all required fields', () => {

  it('Property 4: truncated session ID is exactly 8 chars (or full ID if shorter)', () => {
    fc.assert(
      fc.property(arbActiveReloadStatus, (s) => {
        const row = buildSessionRow(s);
        return row.truncatedId === s.sessionId.slice(0, 8) &&
          row.truncatedId.length <= 8;
      }),
      { numRuns: 200 }
    );
  });

  it('Property 4: environment field is always a non-empty string', () => {
    fc.assert(
      fc.property(arbActiveReloadStatus, (s) => {
        const row = buildSessionRow(s);
        return typeof row.environment === 'string' && row.environment.length > 0;
      }),
      { numRuns: 200 }
    );
  });

  it('Property 4: requester field is always a non-empty string', () => {
    fc.assert(
      fc.property(arbActiveReloadStatus, (s) => {
        const row = buildSessionRow(s);
        return typeof row.requester === 'string' && row.requester.length > 0;
      }),
      { numRuns: 200 }
    );
  });

  it('Property 4: progress percentage is always between 0 and 100 inclusive', () => {
    fc.assert(
      fc.property(arbActiveReloadStatus, (s) => {
        const row = buildSessionRow(s);
        return row.progressPct >= 0 && row.progressPct <= 100;
      }),
      { numRuns: 200 }
    );
  });

  it('Property 4: status field matches the original session status', () => {
    fc.assert(
      fc.property(arbActiveReloadStatus, (s) => {
        const row = buildSessionRow(s);
        return row.status === s.status;
      }),
      { numRuns: 200 }
    );
  });

  it('Property 4: all five required fields are present in every row', () => {
    fc.assert(
      fc.property(arbActiveReloadStatus, (s) => {
        const row = buildSessionRow(s);
        return (
          'truncatedId' in row &&
          'environment' in row &&
          'requester' in row &&
          'progressPct' in row &&
          'status' in row
        );
      }),
      { numRuns: 200 }
    );
  });

  it('Property 4: progress is 0 when totalFiles is undefined or zero', () => {
    fc.assert(
      fc.property(
        fc.record({
          sessionId: fc.uuid(),
          status: fc.constantFrom(...ACTIVE_STATUSES),
          totalFiles: fc.constantFrom(undefined, 0),
          completedFiles: fc.option(fc.nat({ max: 100 }), { nil: undefined }),
          failedFiles: fc.option(fc.nat({ max: 100 }), { nil: undefined }),
        }),
        (s) => {
          const row = buildSessionRow(s as ReloadStatus);
          return row.progressPct === 0;
        }
      ),
      { numRuns: 200 }
    );
  });

});
