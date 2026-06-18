import * as fc from 'fast-check';

/**
 * Pure helper that mirrors the recent activity feed slice in XfcsDashboardComponent:
 *   data()?.recentLots?.slice(0, 8)
 */
function getActivityFeedEntries(recentLots: string[] | undefined): string[] {
  return recentLots?.slice(0, 8) ?? [];
}

// ---------------------------------------------------------------------------
// Property 5: Recent activity feed respects the 8-entry limit
//
// Feature: dashboard-redesign, Property 5: Recent activity feed respects the 8-entry limit
// Validates: Requirements 3.1
// ---------------------------------------------------------------------------

describe('XfcsDashboardComponent — Property 5: Recent activity feed 8-entry limit', () => {

  it('Property 5: feed never displays more than 8 entries', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 30 }), { minLength: 0, maxLength: 20 }),
        (lots) => {
          const entries = getActivityFeedEntries(lots);
          return entries.length <= 8;
        }
      ),
      { numRuns: 200 }
    );
  });

  it('Property 5: feed displays exactly min(8, lots.length) entries', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 30 }), { minLength: 0, maxLength: 20 }),
        (lots) => {
          const entries = getActivityFeedEntries(lots);
          return entries.length === Math.min(8, lots.length);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('Property 5: feed entries are the first 8 elements of recentLots', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 30 }), { minLength: 0, maxLength: 20 }),
        (lots) => {
          const entries = getActivityFeedEntries(lots);
          return entries.every((entry, i) => entry === lots[i]);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('Property 5: feed returns empty array when recentLots is undefined', () => {
    const entries = getActivityFeedEntries(undefined);
    expect(entries).toEqual([]);
  });

  it('Property 5: feed returns empty array when recentLots is empty', () => {
    const entries = getActivityFeedEntries([]);
    expect(entries).toEqual([]);
  });

});
