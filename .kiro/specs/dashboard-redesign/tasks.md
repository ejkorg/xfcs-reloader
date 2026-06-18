# Implementation Plan: Dashboard Redesign

## Overview

Incrementally rebuild `dashboard.component.ts` and update `xfcs-stats.component.ts` to deliver the modern operations dashboard described in the design. All tasks are frontend-only. No backend changes required.

## Tasks

- [x] 1. Update XfcsStatsComponent to support skeleton loading state
  - Add `@Input() loading: boolean = false` to `XfcsStatsComponent`
  - When `loading = true`, render shimmer skeleton placeholders instead of numeric values
  - Skeleton uses a CSS `shimmer` keyframe animation
  - _Requirements: 1.7_

- [x] 1.1 Write property test for skeleton loader visibility
  - **Property 8: Skeleton loaders are shown during loading and hidden otherwise**
  - **Validates: Requirements 1.7**

- [x] 2. Rebuild XfcsDashboardComponent signals and data loading
  - Replace existing `data` and `loading` signals with the full signal set: `data`, `activeSessions`, `loading`, `refreshing`, `connected`, `lastUpdated`
  - Implement `loadDashboard()` to call `getDashboard()` and `getSessions()` in parallel using `forkJoin`
  - Filter sessions to only `processing` and `created` status for `activeSessions`
  - Set `connected` based on API success/failure
  - Set `lastUpdated` on each successful fetch
  - On API failure: show error toast, retain last values, set `connected = false`
  - _Requirements: 1.8, 2.1, 4.1, 4.2, 7.1, 7.3_

- [x] 2.1 Write property test for active sessions filter
  - **Property 3: Active sessions panel filters by status**
  - **Validates: Requirements 2.1, 2.5**

- [x] 2.2 Write property test for connection status indicator
  - **Property 6: Connection status indicator matches API state**
  - **Validates: Requirements 4.1, 4.2**

- [x] 2.3 Write property test for last updated timestamp
  - **Property 7: Last updated timestamp is present after successful load**
  - **Validates: Requirements 7.3**

- [x] 3. Implement auto-refresh
  - In `ngOnInit`, call `loadDashboard()` then start a 30-second interval using RxJS `interval(30000)`
  - Use `takeUntilDestroyed(this.destroyRef)` to clean up on component destroy
  - Background refreshes use `refreshing` signal (not `loading`) so no full-page spinner appears
  - _Requirements: 7.1, 7.2_

- [x] 4. Rebuild dashboard template — header and KPI row
  - Render page header with title, subtitle, and `lastUpdated` timestamp
  - Pass `loading()` input to `XfcsStatsComponent`
  - _Requirements: 1.1, 1.2, 6.5, 7.3_

- [x] 4.1 Write property test for KPI card values
  - **Property 1: KPI card values match DashboardData**
  - **Validates: Requirements 1.2**

- [x] 4.2 Write property test for KPI card color variants
  - **Property 2: KPI card color variants are applied correctly**
  - **Validates: Requirements 1.4, 1.5, 1.6**

- [x] 5. Implement Active Sessions panel
  - Render a `glass-panel` listing all `activeSessions()` entries
  - Each row: truncated session ID (8 chars), environment badge, requester, progress bar (`calcProgress()`), progress %, status badge
  - Empty state: "No active sessions — system is idle."
  - Footer: "View All Sessions →" link to `/history`
  - _Requirements: 2.1, 2.2, 2.3, 2.6_

- [x] 5.1 Write property test for active session row fields
  - **Property 4: Active session rows contain all required fields**
  - **Validates: Requirements 2.3**

- [x] 6. Implement Recent Activity Feed panel
  - Render a `glass-panel` showing `data()?.recentLots?.slice(0, 8)`
  - Each entry: lot ID in monospace, "Extracted" badge
  - Empty state: "No recent lot activity."
  - Footer: "View Full History →" link to `/history`
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 6.1 Write property test for activity feed 8-entry limit
  - **Property 5: Recent activity feed respects the 8-entry limit**
  - **Validates: Requirements 3.1**

- [x] 7. Implement Quick Actions panel
  - Render three buttons using `GlassButtonComponent`: "New Reload" (primary, routerLink `/reload/new`), "View Sessions" (secondary, routerLink `/history`), "File Monitor" (secondary, routerLink `/monitor`)
  - Each button includes a `GlassIconComponent` and a short description line
  - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [x] 8. Implement System Status panel
  - Backend API row: green pulse dot when `connected() = true`, red dot when false
  - Archive Mount row: static path string (hardcoded from config or shown as placeholder)
  - Stuck Timeout row: `data()?.stuckTimeoutMin` value in minutes
  - Quick Tip callout box with ETL workflow explanation
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [x] 9. Apply responsive layout and entrance animations
  - Two-column grid (left 1.8fr, right 1.2fr) for viewports > 1100px
  - Single-column stacked layout at ≤ 1100px
  - Staggered `fadeIn` / `slideUp` animations on header and panels
  - All panels use `glass-panel` CSS class
  - _Requirements: 6.1, 6.2, 6.3, 6.7_

- [x] 10. Checkpoint — Ensure all tests pass
  - Run `ng test --run` and verify all unit and property tests pass
  - Verify the dashboard renders correctly in both dark and light themes
  - Ask the user if any questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- `calcProgress(s)` helper: `Math.round(((completedFiles ?? 0) + (failedFiles ?? 0)) / totalFiles * 100)`
- fast-check is the PBT library; install with `npm install --save-dev fast-check` if not present
- All color values must use existing CSS custom properties — no hardcoded hex values in new code
- The `connected` signal is derived state, not fetched from an endpoint
