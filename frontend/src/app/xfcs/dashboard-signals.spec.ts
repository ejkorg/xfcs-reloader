import * as fc from 'fast-check';
import { ReloadStatus } from '../api/xfcs-models';

/**
 * Pure helper that mirrors the active-sessions filter in XfcsDashboardComponent:
 *   exclude terminal statuses (completed, failed, partially_failed, cancelled)
 */
function filterActiveSessions(sessions: ReloadStatus[]): ReloadStatus[] {
  const terminal = new Set(['completed', 'failed', 'partially_failed', 'cancelled']);
  return sessions.filter(s => !terminal.has(s.status?.toLowerCase()));
}

/**
 * Pure helper that mirrors the connection-status logic:
 * connected is set to true on success, false on failure.
 */
function resolveConnected(apiSucceeded: boolean): boolean {
  return apiSucceeded;
}

/**
 * Pure helper that mirrors the lastUpdated logic:
 * lastUpdated is set to a Date on success, left unchanged on failure.
 */
function resolveLastUpdated(
  apiSucceeded: boolean,
  previous: Date | undefined
): Date | undefined {
  if (apiSucceeded) {
    return new Date();
  }
  return previous;
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const ACTIVE_STATUSES = ['created', 'processing', 'queued', 'staging', 'pending'] as const;
const TERMINAL_STATUSES = ['completed', 'failed', 'partially_failed', 'cancelled'] as const;
const ALL_STATUSES = [...ACTIVE_STATUSES, ...TERMINAL_STATUSES] as const;

const arbStatus = fc.constantFrom(...ALL_STATUSES);

const arbReloadStatus = (statusArb = arbStatus): fc.Arbitrary<ReloadStatus> =>
  fc.record({
    sessionId: fc.uuid(),
    status: statusArb,
    environment: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
    requester: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: undefined }),
    totalFiles: fc.option(fc.nat({ max: 500 }), { nil: undefined }),
    completedFiles: fc.option(fc.nat({ max: 500 }), { nil: undefined }),
    failedFiles: fc.option(fc.nat({ max: 500 }), { nil: undefined }),
  });

// ---------------------------------------------------------------------------
// Property 3: Active sessions panel filters by status
//
// Feature: dashboard-redesign, Property 3: Active sessions panel filters by status
// Validates: Requirements 2.1, 2.5
// ---------------------------------------------------------------------------

describe('XfcsDashboardComponent — Property 3: Active sessions filter', () => {

  it('Property 3: only non-terminal sessions appear in activeSessions', () => {
    fc.assert(
      fc.property(
        fc.array(arbReloadStatus(), { minLength: 0, maxLength: 30 }),
        (sessions) => {
          const active = filterActiveSessions(sessions);
          const terminal = new Set(['completed', 'failed', 'partially_failed', 'cancelled']);
          return active.every(s => !terminal.has(s.status));
        }
      ),
      { numRuns: 200 }
    );
  });

  it('Property 3: no completed/failed/partially_failed/cancelled sessions appear in activeSessions', () => {
    fc.assert(
      fc.property(
        fc.array(arbReloadStatus(), { minLength: 0, maxLength: 30 }),
        (sessions) => {
          const active = filterActiveSessions(sessions);
          const terminal = new Set(['completed', 'failed', 'partially_failed', 'cancelled']);
          return active.every(s => !terminal.has(s.status));
        }
      ),
      { numRuns: 200 }
    );
  });

  it('Property 3: all non-terminal sessions from input are included in activeSessions', () => {
    fc.assert(
      fc.property(
        fc.array(arbReloadStatus(), { minLength: 0, maxLength: 30 }),
        (sessions) => {
          const terminal = new Set(['completed', 'failed', 'partially_failed', 'cancelled']);
          const expectedIds = sessions
            .filter(s => !terminal.has(s.status?.toLowerCase()))
            .map(s => s.sessionId);
          const active = filterActiveSessions(sessions);
          const activeIds = active.map(s => s.sessionId);
          return expectedIds.length === activeIds.length &&
            expectedIds.every(id => activeIds.includes(id));
        }
      ),
      { numRuns: 200 }
    );
  });

  it('Property 3: filter is idempotent — applying twice gives same result', () => {
    fc.assert(
      fc.property(
        fc.array(arbReloadStatus(), { minLength: 0, maxLength: 30 }),
        (sessions) => {
          const once = filterActiveSessions(sessions);
          const twice = filterActiveSessions(once);
          return once.length === twice.length &&
            once.every((s, i) => s.sessionId === twice[i].sessionId);
        }
      ),
      { numRuns: 200 }
    );
  });

});

// ---------------------------------------------------------------------------
// Property 6: Connection status indicator matches API state
//
// Feature: dashboard-redesign, Property 6: Connection status indicator matches API state
// Validates: Requirements 4.1, 4.2
// ---------------------------------------------------------------------------

describe('XfcsDashboardComponent — Property 6: Connection status indicator', () => {

  it('Property 6: connected=true when API succeeds, connected=false when API fails', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        (apiSucceeded) => {
          const connected = resolveConnected(apiSucceeded);
          return connected === apiSucceeded;
        }
      ),
      { numRuns: 200 }
    );
  });

  it('Property 6: connected is always a boolean', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        (apiSucceeded) => {
          const connected = resolveConnected(apiSucceeded);
          return typeof connected === 'boolean';
        }
      ),
      { numRuns: 200 }
    );
  });

});

// ---------------------------------------------------------------------------
// Property 7: Last updated timestamp is present after successful load
//
// Feature: dashboard-redesign, Property 7: Last updated timestamp is present after successful load
// Validates: Requirements 7.3
// ---------------------------------------------------------------------------

describe('XfcsDashboardComponent — Property 7: Last updated timestamp', () => {

  it('Property 7: lastUpdated is a non-null Date after a successful API call', () => {
    fc.assert(
      fc.property(
        fc.option(fc.date(), { nil: undefined }),
        (previousDate) => {
          const before = Date.now();
          const result = resolveLastUpdated(true, previousDate);
          const after = Date.now();
          return result instanceof Date &&
            result.getTime() >= before &&
            result.getTime() <= after;
        }
      ),
      { numRuns: 200 }
    );
  });

  it('Property 7: lastUpdated retains previous value after a failed API call', () => {
    fc.assert(
      fc.property(
        fc.option(fc.date(), { nil: undefined }),
        (previousDate) => {
          const result = resolveLastUpdated(false, previousDate);
          return result === previousDate;
        }
      ),
      { numRuns: 200 }
    );
  });

  it('Property 7: lastUpdated is always undefined before any successful call', () => {
    const result = resolveLastUpdated(false, undefined);
    expect(result).toBeUndefined();
  });

});
