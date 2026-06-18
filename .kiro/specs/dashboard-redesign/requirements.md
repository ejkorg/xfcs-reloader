# Requirements Document

## Introduction

The XFCS Reloader Dashboard is the primary landing page for operators managing archival reload sessions. The current dashboard presents basic KPI cards and a recent lots list, but lacks actionable insight, visual hierarchy, and real-time awareness. This redesign aims to deliver a modern, industry-standard operations dashboard that surfaces the most critical information at a glance, supports quick action, and scales gracefully with the data the system already provides.

The redesign is purely a frontend concern — all data is already available via existing API endpoints (`/xfcs/dashboard`, `/xfcs/sessions`, `/xfcs/reload/:id/files`). No backend changes are required.

## Glossary

- **Dashboard**: The `/dashboard` route rendered by `XfcsDashboardComponent`.
- **KPI Card**: A compact metric tile showing a single numeric value with label and icon.
- **Session**: A reload job tracked by `ReloadStatus`; has a status lifecycle (created → processing → completed/failed/cancelled).
- **Pending File**: A file tracked by `FileStatusItem` that has not yet reached `completed` or `failed`.
- **Activity Feed**: A chronological list of recent system events (lot extractions, session state changes).
- **Quick Action**: A prominent, single-click shortcut to a high-frequency workflow (e.g. New Reload).
- **System_Status**: The health indicator panel showing backend connectivity and mount availability.
- **Trend Indicator**: A small visual cue (arrow + percentage) showing change relative to a prior period.
- **Skeleton_Loader**: A placeholder shimmer animation shown while data is loading.
- **SSE**: Server-Sent Events — the real-time push channel already used by the app.

## Requirements

### Requirement 1: KPI Summary Row

**User Story:** As an operator, I want to see the most important system metrics at a glance, so that I can immediately assess the health of the reload pipeline without navigating away.

#### Acceptance Criteria

1. THE Dashboard SHALL display a KPI summary row containing exactly six metric cards: Total Sessions, Completed, Failed, Active Sessions, Pending Files, and Queued.
2. WHEN the dashboard data loads, THE Dashboard SHALL populate each KPI card with the corresponding value from the `DashboardData` API response.
3. WHEN a KPI card value is zero, THE Dashboard SHALL still render the card with a `0` value and no error state.
4. WHEN the `activeSessions` value is greater than zero, THE Dashboard SHALL display a live pulse animation on the Active Sessions card.
5. WHEN the `failed` value is greater than zero, THE Dashboard SHALL apply a danger color variant to the Failed card value.
6. WHEN the `completed` value is greater than zero, THE Dashboard SHALL apply a success color variant to the Completed card value.
7. WHILE data is loading, THE Dashboard SHALL display Skeleton_Loader placeholders in place of KPI card values.
8. IF the dashboard API call fails, THEN THE Dashboard SHALL display an error toast and retain the last successfully loaded values (or zeros on first load).

### Requirement 2: Active Sessions Panel

**User Story:** As an operator, I want to see currently running reload sessions directly on the dashboard, so that I can monitor in-progress work without switching to the Sessions page.

#### Acceptance Criteria

1. THE Dashboard SHALL display an Active Sessions panel showing all sessions with status `processing` or `created`.
2. WHEN there are no active sessions, THE Dashboard SHALL display an empty-state message: "No active sessions — system is idle."
3. WHEN an active session is displayed, THE Dashboard SHALL show: session ID (truncated to 8 chars), environment badge, requester, file progress bar, progress percentage, and status badge.
4. WHEN a session's `completedFiles` or `failedFiles` count changes via SSE, THE Dashboard SHALL update the progress bar without a full page reload.
5. WHEN a session transitions to `completed` or `failed`, THE Dashboard SHALL remove it from the Active Sessions panel within one SSE event cycle.
6. THE Dashboard SHALL provide a "View All Sessions" link that navigates to `/history`.

### Requirement 3: Recent Activity Feed

**User Story:** As an operator, I want a chronological feed of recent lot extractions and session events, so that I can quickly understand what has happened recently without reading raw logs.

#### Acceptance Criteria

1. THE Dashboard SHALL display a Recent Activity Feed showing the most recent 8 entries from `DashboardData.recentLots`.
2. WHEN a lot entry is displayed, THE Dashboard SHALL show the lot ID in monospace font with an "Extracted" status badge.
3. WHEN the `recentLots` array is empty, THE Dashboard SHALL display: "No recent lot activity."
4. THE Dashboard SHALL provide a "View Full History" link that navigates to `/history`.
5. WHEN the dashboard data refreshes, THE Dashboard SHALL animate newly added lot entries with a fade-in transition.

### Requirement 4: System Status Panel

**User Story:** As an operator, I want to see the current system health at a glance, so that I can quickly identify connectivity or configuration issues.

#### Acceptance Criteria

1. THE System_Status panel SHALL display a "Backend API" row with a green connected indicator when the dashboard API call succeeds.
2. IF the dashboard API call fails, THEN THE System_Status panel SHALL display a red disconnected indicator for "Backend API".
3. THE System_Status panel SHALL display an "Archive Mount" row showing the configured mount path.
4. THE System_Status panel SHALL display a "Stuck Timeout" row showing the `stuckTimeoutMin` value from `DashboardData` in minutes.
5. THE System_Status panel SHALL display a contextual Quick Tip explaining the reload workflow.

### Requirement 5: Quick Actions

**User Story:** As an operator, I want prominent quick-action shortcuts on the dashboard, so that I can start the most common workflows in one click.

#### Acceptance Criteria

1. THE Dashboard SHALL display a "New Reload" primary action button that navigates to `/reload/new`.
2. THE Dashboard SHALL display a "View Sessions" secondary action button that navigates to `/history`.
3. THE Dashboard SHALL display a "File Monitor" secondary action button that navigates to `/monitor`.
4. WHEN a quick action button is clicked, THE Dashboard SHALL navigate to the corresponding route immediately.

### Requirement 6: Layout and Visual Design

**User Story:** As an operator, I want the dashboard to follow a modern, industry-standard operations UI pattern, so that the interface feels professional and is easy to scan.

#### Acceptance Criteria

1. THE Dashboard SHALL use a two-column grid layout for the main content area (activity feed + status/actions column) on viewports wider than 1100px.
2. WHEN the viewport width is 1100px or less, THE Dashboard SHALL collapse to a single-column stacked layout.
3. THE Dashboard SHALL use the existing `glass-panel` CSS class for all content cards to maintain visual consistency.
4. THE Dashboard SHALL use the existing CSS custom properties (`--accent-color`, `--text-muted`, `--success`, `--error`, `--warning`) for all color values.
5. THE Dashboard SHALL display a page header with the title "XFCS Reloader Dashboard" and a subtitle.
6. THE Dashboard SHALL support both dark and light themes via the existing `body.light-theme` / `body.dark-theme` CSS classes.
7. WHEN the dashboard first loads, THE Dashboard SHALL animate the header and panels with a staggered fade-in/slide-up entrance.

### Requirement 7: Data Refresh

**User Story:** As an operator, I want the dashboard to stay current without manual intervention, so that I always see up-to-date metrics.

#### Acceptance Criteria

1. THE Dashboard SHALL automatically refresh dashboard data every 30 seconds.
2. WHEN a manual refresh is triggered, THE Dashboard SHALL reload all dashboard data and update all panels.
3. THE Dashboard SHALL display a "Last updated" timestamp showing when the data was last successfully fetched.
4. WHEN data is refreshing in the background, THE Dashboard SHALL not show a full-page loading state — only a subtle indicator.
