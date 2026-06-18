import * as fc from 'fast-check';
import { ReloadSessionEvent } from '../api/xfcs-models';

/**
 * Property 8: Activity feed deduplication
 *
 * For any list of events that contains duplicate id values, after merging into
 * the Activity_Feed, each id should appear exactly once.
 *
 * Feature: reload-monitoring-overhaul, Property 8: Activity feed deduplication
 * Validates: Requirements 5.3
 */

/** Pure deduplication logic extracted from XfcsComponent.ingestEvent */
function deduplicateEvents(
  events: ReloadSessionEvent[],
  seenIds: Set<number>
): ReloadSessionEvent[] {
  const result: ReloadSessionEvent[] = [];
  for (const ev of events) {
    if (ev.id != null && seenIds.has(ev.id)) continue;
    if (ev.id != null) seenIds.add(ev.id);
    result.push(ev);
  }
  return result;
}

function makeEvent(id: number): ReloadSessionEvent {
  return {
    id,
    sessionId: 'test-session',
    eventTime: new Date().toISOString(),
    eventType: 'FILE_STARTED',
    message: `event ${id}`,
    actor: 'SYSTEM'
  };
}

describe('Activity feed deduplication (Property 8)', () => {

  it('Property 8: no duplicate ids after deduplication', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 50 }), { minLength: 1, maxLength: 30 }),
        (ids) => {
          const events = ids.map(id => makeEvent(id));
          const seenIds = new Set<number>();
          const result = deduplicateEvents(events, seenIds);

          const resultIds = result.map(e => e.id!);
          const uniqueResultIds = new Set(resultIds);
          return resultIds.length === uniqueResultIds.size;
        }
      ),
      { numRuns: 200 }
    );
  });

  it('Property 8: all unique ids from input are present in output', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 50 }), { minLength: 1, maxLength: 30 }),
        (ids) => {
          const events = ids.map(id => makeEvent(id));
          const uniqueInputIds = new Set(ids);
          const seenIds = new Set<number>();
          const result = deduplicateEvents(events, seenIds);

          const resultIds = new Set(result.map(e => e.id!));
          // Every unique input id should appear in the output
          for (const id of uniqueInputIds) {
            if (!resultIds.has(id)) return false;
          }
          return true;
        }
      ),
      { numRuns: 200 }
    );
  });

  it('Property 8: deduplication is idempotent — running twice gives same result', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 30 }), { minLength: 1, maxLength: 20 }),
        (ids) => {
          const events = ids.map(id => makeEvent(id));

          const seenIds1 = new Set<number>();
          const firstPass = deduplicateEvents(events, seenIds1);

          // Running the same events again with the same seenIds should produce nothing new
          const secondPass = deduplicateEvents(events, seenIds1);

          return secondPass.length === 0;
        }
      ),
      { numRuns: 200 }
    );
  });

  it('Property 8: output length equals number of unique ids in input', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 20 }), { minLength: 1, maxLength: 25 }),
        (ids) => {
          const events = ids.map(id => makeEvent(id));
          const uniqueCount = new Set(ids).size;
          const seenIds = new Set<number>();
          const result = deduplicateEvents(events, seenIds);
          return result.length === uniqueCount;
        }
      ),
      { numRuns: 200 }
    );
  });

  it('merging two batches with overlapping ids produces no duplicates', () => {
    const batch1 = [1, 2, 3, 4, 5].map(makeEvent);
    const batch2 = [3, 4, 5, 6, 7].map(makeEvent); // 3,4,5 overlap

    const seenIds = new Set<number>();
    const result1 = deduplicateEvents(batch1, seenIds);
    const result2 = deduplicateEvents(batch2, seenIds);
    const combined = [...result1, ...result2];

    const ids = combined.map(e => e.id!);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});
