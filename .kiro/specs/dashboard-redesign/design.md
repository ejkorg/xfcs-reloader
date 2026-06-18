# Design Document: Dashboard Redesign

## Overview

The XFCS Reloader Dashboard redesign transforms the current basic metrics page into a modern, operations-grade dashboard. The design follows patterns common in industrial monitoring UIs (Datadog, Grafana, Linear) — clear visual hierarchy, real-time awareness, and zero-click access to the most important information.

All data is sourced from existing API endpoints. No backend changes are required. The redesign is scoped entirely to `dashboard.component.ts` and the `xfcs-stats.component.ts` it hosts.

## Architecture

The dashboard is a single Angular standalone component (`XfcsDashboardComponent`) that:

1. Fetches `DashboardData` on init and every 30 seconds via `XfcsApiService.getDashboard()`
2. Fetches active sessions via `XfcsApiService.getSessions()` filtered to `processing` / `created` status
3. Renders four distinct panels in a responsive grid
4. Tracks a `connected` signal derived from whether the last API call succeeded

```
XfcsDashboardComponent
├── KPI Row          ← XfcsStatsComponent (updated)
├── Main Grid
│   ├── Left Column
│   │   ├── Active Sessions Panel
│   │   └── Recent Activity Feed
│   └── Right Column
│       ├── Quick Actions Panel
│       └── System Status Panel
└── Auto-refresh (interval 30s)
```

## Components and Interfaces

### XfcsDashboardComponent (primary)

Signals:
- `data = signal<DashboardData | undefined>(undefined)` — dashboard metrics
- `activeSessions = signal<ReloadStatus[]>([])` — filtered active sessions
- `loading = signal(false)` — initial load state
- `refreshing = signal(false)` — background refresh state
- `connected = signal(true)` — derived from last API success/failure
- `lastUpdated = signal<Date | undefined>(undefined)` — timestamp of last successful fetch

Methods:
- `loadDashboard()` — fetches DashboardData and active sessions in parallel
- `startAutoRefresh()` — sets up a 30s interval using `interval()` from RxJS, torn down via `DestroyRef`

### XfcsStatsComponent (updated)

The existing stats component is updated to:
- Accept a `loading` input for skeleton state
- Render skeleton shimmer placeholders when `loading = true`

### Layout Panels

**KPI Row** — full-width, 6 cards using existing `XfcsStatsComponent`

**Active Sessions Panel** (left column, top)
- Lists sessions with status `processing` or `created`
- Each row: session ID chip, environment badge, requester, progress bar, status badge
- Empty state when no active sessions
- "View All Sessions →" footer link

**Recent Activity Feed** (left column, bottom)
- Shows up to 8 recent lot IDs from `DashboardData.recentLots`
- Each entry: lot ID (monospace), "Extracted" badge, subtle timestamp placeholder
- "View Full History →" footer link

**Quick Actions Panel** (right column, top)
- Three action buttons: New Reload (primary), View Sessions (secondary), File Monitor (secondary)
- Each button has an icon and descriptive label

**System Status Panel** (right column, bottom)
- Backend API connectivity row (green/red dot + label)
- Archive Mount path row
- Stuck Timeout row (from `DashboardData.stuckTimeoutMin`)
- Quick Tip callout box

## Data Models

All models are already defined in `xfcs-models.ts`. No new models needed.

Key fields used:

```typescript
interface DashboardData {
  generatedAt: string;
  totalRequests: number;
  completed: number;
  failed: number;
  recentLots: string[];       // up to 8 shown in feed
  activeSessions: number;
  pendingFiles: number;
  stuckTimeoutMin: number;    // shown in system status
}

interface ReloadStatus {
  sessionId: string;
  status: string;             // filter: 'processing' | 'created'
  environment?: string;
  requester?: string;
  totalFiles?: number;
  completedFiles?: number;
  failedFiles?: number;
  updatedAt?: string;
}
```

## Visual Design Specification

### Layout Grid

```
┌─────────────────────────────────────────────────────────┐
│  Header: Title + Subtitle + Last Updated                │
├─────────────────────────────────────────────────────────┤
│  KPI Row: [Total] [Completed] [Failed] [Active] [Pending] [Queued]  │
├──────────────────────────────┬──────────────────────────┤
│  Active Sessions Panel       │  Quick Actions Panel     │
│  (expandable rows)           │  [New Reload]            │
│                              │  [View Sessions]         │
│                              │  [File Monitor]          │
├──────────────────────────────┼──────────────────────────┤
│  Recent Activity Feed        │  System Status Panel     │
│  (lot list, max 8)           │  • Backend API           │
│                              │  • Archive Mount         │
│                              │  • Stuck Timeout         │
│                              │  💡 Quick Tip            │
└──────────────────────────────┴──────────────────────────┘
```

### Color Usage

| Element | Token |
|---|---|
| Active session progress | `--accent-color` |
| Completed value | `--success` (#10b981) |
| Failed value | `--error` (#ef4444) |
| Warning/tip | `--warning` (#f59e0b) |
| Muted labels | `--text-muted` |
| Panel backgrounds | `--card-bg` + `glass-panel` class |

### Skeleton Loader

When `loading = true`, KPI cards render a shimmer placeholder:

```html
<div class="skeleton-val"></div>
```

```scss
.skeleton-val {
  width: 3rem; height: 2rem;
  border-radius: 6px;
  background: linear-gradient(90deg, rgba(255,255,255,0.04) 25%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.04) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.4s infinite;
}
@keyframes shimmer { to { background-position: -200% 0; } }
```

### Progress Bar Calculation

```typescript
calcProgress(s: ReloadStatus): number {
  if (!s.totalFiles) return 0;
  const done = (s.completedFiles ?? 0) + (s.failedFiles ?? 0);
  return Math.round((done / s.totalFiles) * 100);
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property-Based Testing Overview

Property-based testing (PBT) validates software correctness by testing universal properties across many generated inputs. Each property is a formal specification that should hold for all valid inputs.

The testing library for this Angular project is **Jest** with **fast-check** for property-based testing.

---

Property 1: KPI card values match DashboardData
*For any* valid `DashboardData` object, when the dashboard component is rendered with that data, each of the six KPI cards SHALL display the exact numeric value from the corresponding field (`totalRequests`, `completed`, `failed`, `activeSessions`, `pendingFiles`, and the computed queued count).
**Validates: Requirements 1.2**

---

Property 2: KPI card color variants are applied correctly
*For any* `DashboardData` object, the Failed card SHALL have the danger CSS class if and only if `failed > 0`, the Completed card SHALL have the success CSS class if and only if `completed > 0`, and the Active Sessions card SHALL show the pulse element if and only if `activeSessions > 0`.
**Validates: Requirements 1.4, 1.5, 1.6**

---

Property 3: Active sessions panel filters by status
*For any* list of `ReloadStatus` objects, the Active Sessions panel SHALL display exactly those sessions whose `status` is `'processing'` or `'created'`, and no others.
**Validates: Requirements 2.1, 2.5**

---

Property 4: Active session rows contain all required fields
*For any* `ReloadStatus` object with status `processing` or `created`, the rendered session row SHALL contain the truncated session ID, environment badge, requester, a progress bar element, and a status badge.
**Validates: Requirements 2.3**

---

Property 5: Recent activity feed respects the 8-entry limit
*For any* `DashboardData` with a `recentLots` array of arbitrary length, the rendered feed SHALL display at most 8 entries, and those entries SHALL be the first 8 elements of the array.
**Validates: Requirements 3.1**

---

Property 6: Connection status indicator matches API state
*For any* component state where `connected = true`, the Backend API row SHALL show the online indicator class; when `connected = false`, it SHALL show the offline indicator class.
**Validates: Requirements 4.1, 4.2**

---

Property 7: Last updated timestamp is present after successful load
*For any* successful `getDashboard()` response, the `lastUpdated` signal SHALL be set to a non-null `Date` value, and the dashboard header SHALL render a non-empty timestamp string.
**Validates: Requirements 7.3**

---

Property 8: Skeleton loaders are shown during loading and hidden otherwise
*For any* component state, skeleton placeholder elements SHALL be present in the DOM if and only if `loading = true`.
**Validates: Requirements 1.7**

## Error Handling

| Scenario | Behavior |
|---|---|
| `getDashboard()` fails on initial load | Show error toast; render zeros; `connected = false` |
| `getDashboard()` fails on background refresh | Show error toast; retain last values; `connected = false` |
| `getSessions()` fails | Active Sessions panel shows empty state; no crash |
| Both calls fail simultaneously | Single error toast; all panels show empty/zero states |

## Testing Strategy

### Dual Testing Approach

Both unit tests and property-based tests are required. They are complementary:
- Unit tests verify specific examples, edge cases, and error conditions
- Property tests verify universal properties across all inputs

### Unit Tests (Jest)

- Dashboard renders with empty/undefined data (no crash)
- Error toast is shown when API fails
- "New Reload" button navigates to `/reload/new`
- "View Sessions" button navigates to `/history`
- "File Monitor" button navigates to `/monitor`
- Auto-refresh triggers `loadDashboard()` after 30 seconds (fake timers)
- Empty state message shown when `recentLots = []`
- Empty state message shown when no active sessions

### Property-Based Tests (fast-check)

Each property from the Correctness Properties section is implemented as a single property-based test with a minimum of 100 iterations.

Tag format: `Feature: dashboard-redesign, Property {N}: {property_text}`

- **Property 1** — `fc.record({ totalRequests: fc.nat(), completed: fc.nat(), ... })` → verify card values
- **Property 2** — `fc.record({ failed: fc.nat(), completed: fc.nat(), activeSessions: fc.nat() })` → verify CSS classes
- **Property 3** — `fc.array(fc.record({ status: fc.constantFrom('processing','created','completed','failed','cancelled') }))` → verify filter
- **Property 4** — `fc.record({ sessionId: fc.string(), environment: fc.string(), ... })` → verify row fields
- **Property 5** — `fc.array(fc.string(), { minLength: 0, maxLength: 20 })` → verify slice to 8
- **Property 6** — `fc.boolean()` → verify indicator class
- **Property 7** — verify `lastUpdated` is set after mock API success
- **Property 8** — `fc.boolean()` for loading state → verify skeleton presence
