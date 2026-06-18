# Implementation Plan: Session Log & Environment Destination Redesign

## Overview

Incremental implementation: backend schema + entity first, then monitor wiring, then API exposure, then frontend redesign. Each step is independently verifiable.

---

## Tasks

- [x] 1. Database schema migration and entity update
  - Create `db.changelog-5.7-pending-files-destination.xml` adding `destination_folder VARCHAR(32)` (nullable) to `xfcs_dearchiver_reload_pending_files`.
  - Register the new changeset in `db.changelog-master.xml`.
  - Add `destinationFolder` field, getter, and setter to `ReloadPendingFileEntity`.
  - _Requirements: 2.3_

- [x] 2. Wire destination detection into ReloadPendingMonitor
  - [x] 2.1 In the `completed` branch of `scanPendingFiles()`, after calling `detectDestinationFolder(foundStr)`, call `pf.setDestinationFolder(destination)` before saving the entity.
    - The `detectDestinationFolder` method already exists — no changes to detection logic needed.
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 2.2 Write property test for destination detection round-trip
    - **Property 2: Destination detection round-trip**
    - **Validates: Requirements 2.2, 2.3, 2.5**

  - [x] 2.3 Write property test for graceful null destination
    - **Property 3: Graceful null destination**
    - **Validates: Requirements 2.4**

- [x] 3. Verify FileStatusDto mapping includes destinationFolder
  - In `ReloadSessionService.getSessionFiles()`, confirm the `FileStatusDto` constructor call passes `entity.getDestinationFolder()` for the `destinationFolder` field.
  - If the mapping is missing, add it.
  - _Requirements: 2.5_

- [x] 4. Expose logPath in envInfo endpoint
  - In `XfcsController.envInfo()`, inside the `if (resolution != null)` block, add `out.put("logPath", resolution.logPath())`.
  - _Requirements: 1.1, 1.2_

  - [x] 4.1 Write property test for logPath in envInfo response
    - **Property 1: Log path included in envInfo response**
    - **Validates: Requirements 1.1**

- [x] 5. Checkpoint — Ensure all backend tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Update frontend models
  - Add `logPath?: string` to the `EnvInfo` interface in `xfcs-models.ts`.
  - Add `processingDestination?: 'PRODUCTION' | 'SANDBOX' | null` to the `FileStatusItem` interface in `xfcs-models.ts`.
  - _Requirements: 1.3, 2.6_

- [x] 7. Redesign XfcsSessionsComponent
  - [x] 7.1 Add computed signals and helper methods to the component class:
    - `sortedSessions = computed(() => [...this.sessions()].sort((a, b) => new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime()))`
    - `copiedId = signal<string | null>(null)`
    - `destinationSummary(files: FileStatusItem[])` returning `{ total, production, sandbox, failed }`
    - `copySessionId(id: string)` using `navigator.clipboard.writeText` with 1.5s timeout to clear `copiedId`
    - Map `destinationFolder` → `processingDestination` in `loadFileStatus()` after receiving API response
    - _Requirements: 3.6, 5.1, 5.2, 7.1, 7.2, 7.3_

  - [x] 7.2 Redesign the component template:
    - Replace the existing template with the new layout: header with active-session count badge, loading skeleton (shown when `loading() === true`), empty-state panel (shown when `sortedSessions().length === 0 && !loading()`), and the sessions table using `sortedSessions()`.
    - Session row: expand toggle, session-id cell (click → `copySessionId`, shows `Copied!` tooltip when `copiedId() === s.sessionId`), requester, env-badge, files count, progress-cell, status-badge with `aria-label`, updated timestamp.
    - Detail row: sticky summary bar (total / PRODUCTION count / SANDBOX count / failed count), file list with destination-badge and file-status-badge each having `aria-label`.
    - _Requirements: 3.1, 3.2, 3.4, 3.5, 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.3, 5.4, 6.3, 7.1, 7.2_

  - [x] 7.3 Update component styles:
    - Add `.destination-badge.production` (green), `.destination-badge.sandbox` (amber), `.destination-badge.unknown` (gray) styles.
    - Add `.skeleton` loading animation using CSS `@keyframes shimmer`.
    - Add `.empty-state` centered panel with icon and message.
    - Add `.summary-bar` sticky header inside detail row.
    - Add `.copied-tooltip` transient tooltip style.
    - Ensure all colors use CSS variables (`--success`, `--error`, `--accent-color`, `--text-muted`, `--text-main`) for theme compatibility.
    - _Requirements: 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 6.4_

  - [x] 7.4 Write property test for sessions sorted by updatedAt descending
    - **Property 4: Sessions sorted by updatedAt descending**
    - **Validates: Requirements 3.6**

  - [x] 7.5 Write property test for destination badge rendering correctness
    - **Property 5: Destination badge rendering correctness**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5**

  - [x] 7.6 Write property test for destination summary counts correctness
    - **Property 6: Destination summary counts correctness**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4**

  - [x] 7.7 Write property test for copy session ID interaction
    - **Property 7: Copy session ID interaction**
    - **Validates: Requirements 7.1, 7.2**

- [x] 8. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Add ECharts dependency to xfcs-reloader frontend
  - Add `echarts` to `package.json` dependencies (same version as dtp-resender).
  - Verify the import `import * as echarts from 'echarts'` compiles without errors in the Angular project.
  - _Requirements: 8.7_

- [x] 10. Add session detail modal to XfcsSessionsComponent
  - [x] 10.1 Add new signals and computed values to the component class:
    - `selectedSession = signal<ReloadStatus | null>(null)`
    - `chartsExpanded = signal(true)`, `filesTableExpanded = signal(true)`
    - `analyticsStartDate = signal<string | null>(null)`, `analyticsEndDate = signal<string | null>(null)`
    - `filteredFiles = computed(...)` — filters `selectedFiles()` by date range
    - `analyticsStatusSummary = computed(...)` — computes completed/failed/cancelled percentages from `filteredFiles()`
    - `dailyStatusRows = computed(() => buildDailyTrend(this.filteredFiles()))`
    - `buildDailyTrend(files)` helper — groups files by `createdAt` date, returns sorted array of `{ day, done, failed, staging, pending }`
    - `selectSession(session)`, `closeDetail()`, `refreshSession()`, `cancelSession()`, `exportCurrentSessionFiles()` methods
    - `applyAnalyticsDateRange()`, `clearAnalyticsDateRange()`, `applyQuickPreset(preset)` methods
    - After files load: set `analyticsStartDate` to earliest `createdAt` date
    - _Requirements: 8.1, 8.3, 8.4, 8.8, 9.1, 9.2, 9.4_

  - [x] 10.2 Add the modal overlay template:
    - `detail-overlay` (fixed full-screen backdrop) shown when `selectedSession() !== null`
    - `detail-modal` with sticky `detail-head` (title, status badge, updated, Copy ID, action buttons)
    - Metrics bar (total / completed / failed / status pills from `selectedDetail()`)
    - Collapsible charts section with toggle button, date-range controls, preset buttons, status-summary pills, and 2-column charts grid (`#trendChartContainer`, `#statusChartContainer`)
    - Collapsible files section with toggle button and `hub-table.files` (columns: Lot | Filename | Status | Destination | Created | End Time)
    - Destination badge column: PRODUCTION (green) / SANDBOX (amber) / UNKNOWN (gray) for completed files
    - Backdrop click closes modal
    - _Requirements: 8.1, 8.2, 8.5, 8.6, 9.3_

  - [x] 10.3 Add ECharts initialization:
    - `@ViewChild('trendChartContainer') trendChartRef!: ElementRef`
    - `@ViewChild('statusChartContainer') statusChartRef!: ElementRef`
    - `initCharts()` — called after modal opens and files load; initializes ECharts instances with Daily Status Trend (stacked bar) and Status Distribution (donut) options
    - `destroyCharts()` — called in `closeDetail()` and `ngOnDestroy()`
    - Re-render charts when `filteredFiles` computed signal changes (use `effect()`)
    - _Requirements: 8.7, 9.1, 9.2_

  - [x] 10.4 Add modal and chart styles:
    - `.detail-overlay`, `.detail-modal` (glassmorphism, max 1180px × 860px, scrollable)
    - `.detail-head` (sticky, gradient background)
    - `.charts-section`, `.charts-toggle`, `.charts-panel`, `.charts-grid`, `.chart-card`
    - `.preset-row`, `.preset-btn`, `.status-summary`
    - `.detail-table-wrap` (scrollable, sticky thead)
    - All colors via CSS variables for dark/light theme support
    - _Requirements: 8.1, 8.2, 6.4_

  - [x] 10.5 Write property test for analytics date range filter
    - **Property 8: Analytics date range filter**
    - **Validates: Requirements 8.4, 9.1, 9.2**

  - [x] 10.6 Write property test for daily trend grouping correctness
    - **Property 9: Daily trend grouping correctness**
    - **Validates: Requirements 9.1**

- [x] 11. Update session row click behavior
  - Change session row `(click)` from `toggleExpand(s.sessionId)` to `selectSession(s)` to open the modal instead of inline expand.
  - Remove the inline detail-row expand logic (tasks 7.1–7.3 already implemented the inline version; this replaces it with the modal).
  - Keep the sessions table compact (no expand rows) — all detail is in the modal.
  - _Requirements: 8.1, 8.6_

- [x] 12. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

---

## Notes

- All tasks are required, including tests.
- The `detectDestinationFolder` method already exists in `ReloadPendingMonitor` — no new detection logic is needed.
- The `FileStatusDto` already has a `destinationFolder` field — only the entity mapping needs verification.
- Property tests use **jqwik** (Java backend) and **fast-check** (TypeScript frontend).
- Unit tests use JUnit 5 + Mockito (backend) and Jest (frontend).
- Node.js is not available in this environment — frontend tests must be run manually by the user.
