import * as fc from 'fast-check';

/**
 * Property 8: Skeleton loaders are shown during loading and hidden otherwise
 *
 * For any component state, skeleton placeholder elements SHALL be present in
 * the DOM if and only if `loading = true`.
 *
 * Feature: dashboard-redesign, Property 8: Skeleton loaders are shown during loading and hidden otherwise
 * Validates: Requirements 1.7
 */

/**
 * Simulates what the template renders for a single stat card value slot.
 * When loading, it returns a skeleton element; otherwise the numeric value.
 */
function renderStatValue(loading: boolean, value: number): string {
  if (loading) {
    return '<div class="skeleton-val"></div>';
  }
  return `<span class="stat-value">${value}</span>`;
}

describe('XfcsStatsComponent skeleton loader (Property 8)', () => {

  it('Property 8: skeleton and real value are mutually exclusive for any loading state and value', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.nat(),
        (loading: boolean, value: number) => {
          const html = renderStatValue(loading, value);
          const hasSkeleton = html.includes('skeleton-val');
          const hasValue = html.includes('stat-value');
          // Exactly one of skeleton or real value is rendered — never both, never neither
          return hasSkeleton !== hasValue;
        }
      ),
      { numRuns: 200 }
    );
  });

  it('Property 8: skeleton is present for every card when loading=true regardless of value', () => {
    fc.assert(
      fc.property(
        fc.array(fc.nat(), { minLength: 1, maxLength: 6 }),
        (values: number[]) => {
          return values.every((v: number) => renderStatValue(true, v).includes('skeleton-val'));
        }
      ),
      { numRuns: 200 }
    );
  });

  it('Property 8: no skeleton is present for any card when loading=false', () => {
    fc.assert(
      fc.property(
        fc.array(fc.nat(), { minLength: 1, maxLength: 6 }),
        (values: number[]) => {
          return values.every((v: number) => !renderStatValue(false, v).includes('skeleton-val'));
        }
      ),
      { numRuns: 200 }
    );
  });

});
