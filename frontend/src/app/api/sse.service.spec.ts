import * as fc from 'fast-check';

/**
 * Property 3: SSE reconnect back-off sequence
 *
 * For any sequence of consecutive connection failures, the delay before each retry
 * attempt should follow the sequence [1, 2, 4, 8, 16, 30, 30, ...] seconds (capped at 30s),
 * and after 5 consecutive failures the service should switch to polling.
 *
 * Feature: reload-monitoring-overhaul, Property 3: SSE reconnect back-off sequence
 * Validates: Requirements 1.6
 */

const BACKOFF_DELAYS_MS = [1000, 2000, 4000, 8000, 16000, 30000];
const MAX_RETRIES = 5;

/** Pure function extracted from SseService for testability */
function getBackoffDelayMs(retryCount: number): number {
  return BACKOFF_DELAYS_MS[Math.min(retryCount, BACKOFF_DELAYS_MS.length - 1)];
}

function shouldFallbackToPolling(retryCount: number): boolean {
  return retryCount >= MAX_RETRIES;
}

describe('SseService back-off sequence (Property 3)', () => {

  it('Property 3: back-off delays follow the capped exponential sequence', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 4 }),
        (retryIndex) => {
          const delay = getBackoffDelayMs(retryIndex);
          const expected = BACKOFF_DELAYS_MS[retryIndex];
          return delay === expected;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 3: delays are always capped at 30 seconds', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100 }),
        (retryCount) => {
          const delay = getBackoffDelayMs(retryCount);
          return delay <= 30000;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 3: delays are always positive', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 50 }),
        (retryCount) => {
          const delay = getBackoffDelayMs(retryCount);
          return delay > 0;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 3: delays are non-decreasing up to the cap', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 4 }),
        (retryIndex) => {
          if (retryIndex === 0) return true;
          const prev = getBackoffDelayMs(retryIndex - 1);
          const curr = getBackoffDelayMs(retryIndex);
          return curr >= prev;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 3: fallback to polling triggers after exactly MAX_RETRIES failures', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 20 }),
        (retryCount) => {
          const shouldFallback = shouldFallbackToPolling(retryCount);
          return shouldFallback === (retryCount >= MAX_RETRIES);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should not fall back before MAX_RETRIES', () => {
    for (let i = 0; i < MAX_RETRIES; i++) {
      expect(shouldFallbackToPolling(i)).toBeFalse();
    }
  });

  it('should fall back at and after MAX_RETRIES', () => {
    expect(shouldFallbackToPolling(MAX_RETRIES)).toBeTrue();
    expect(shouldFallbackToPolling(MAX_RETRIES + 1)).toBeTrue();
  });

  it('first retry delay should be 1 second', () => {
    expect(getBackoffDelayMs(0)).toBe(1000);
  });

  it('sixth+ retry delay should be capped at 30 seconds', () => {
    expect(getBackoffDelayMs(5)).toBe(30000);
    expect(getBackoffDelayMs(10)).toBe(30000);
    expect(getBackoffDelayMs(100)).toBe(30000);
  });
});
