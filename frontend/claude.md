# XFCS Reloader — Frontend Developer Guide

## Project Purpose

The XFCS Reloader frontend is an **Angular 21** standalone-component SPA that provides:
- Login using shared DTP Resender user accounts (JWT-based)
- XFCS archive search interface (by environment + lot IDs)
- Reload session creation and live progress monitoring
- Environment info and archive lot lookup dialogs

The app connects to two backends:
- **DTP Resender** (`/resender/api/auth`) — authentication only
- **XFCS Reloader** (`/xfcs-reloader/api/xfcs`) — all domain operations

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Angular 21 (standalone components, signal-based state) |
| Styling | SCSS, CSS variables, glassmorphism design system |
| Icons | Material Icons (via CDN) + custom SVG `GlassIconComponent` |
| UI Components | Custom glass component library (see below) |
| Dialogs | Angular Material CDK Overlay + Material Dialog |
| HTTP | Angular `HttpClient` with bearer token injection |
| Auth | JWT stored in `localStorage`, validated on each request |
| Build | Angular CLI (`ng build`) |

---

## Folder Structure

```
src/
├── app/
│   ├── api/
│   │   ├── xfcs-api.service.ts        # All /api/xfcs/* HTTP calls
│   │   └── xfcs-models.ts             # TypeScript interfaces for all DTOs
│   │
│   ├── auth/
│   │   ├── auth.guard.ts              # Route guard: redirects to /login if no token
│   │   ├── auth.interceptor.ts        # Attaches Authorization header to outbound requests
│   │   ├── auth.service.ts            # Login, logout, token storage, user observable
│   │   └── login.component.ts         # Login form page
│   │
│   ├── core/
│   │   └── theme.service.ts           # Dark/light theme toggle + localStorage persistence
│   │
│   ├── shared/
│   │   ├── components/
│   │   │   ├── glass-button.component.ts      # Buttons: primary/secondary/danger/icon/loading
│   │   │   ├── glass-input.component.ts       # Floating-label text input (ControlValueAccessor)
│   │   │   ├── glass-select.component.ts      # Custom dropdown with keyboard nav + CDK overlay
│   │   │   ├── glass-icon.component.ts        # SVG icon library (20+ named icons)
│   │   │   ├── glass-loading-overlay.component.ts  # Full-screen loading overlay
│   │   │   ├── activity-feed.component.ts     # Auto-scrolling timeline feed
│   │   │   └── toast-container.component.ts   # Toast notification display
│   │   └── services/
│   │       └── toast.service.ts               # Signal-based toast management
│   │
│   ├── xfcs/
│   │   ├── xfcs.component.ts                  # Main page orchestrator (slim)
│   │   ├── xfcs-hero.component.ts             # Hero: env select + lot IDs + action buttons
│   │   ├── xfcs-stats.component.ts            # Dashboard stats cards grid
│   │   ├── xfcs-session-monitor.component.ts  # Active session progress panel
│   │   ├── xfcs-results-table.component.ts    # Archive search results table
│   │   ├── search-results-dialog.component.ts # Search summary dialog
│   │   ├── env-info-dialog.component.ts       # Environment details dialog
│   │   └── find-archive-lots-dialog.component.ts # Lot search dialog
│   │
│   ├── app.config.ts    # Angular app providers (router, HTTP, animations)
│   ├── app.html         # App shell template (header + router-outlet + toast)
│   ├── app.routes.ts    # Route definitions with auth guard + feature flag guard
│   ├── app.scss         # App shell styles (header, nav, user-info, glow orbs)
│   └── app.ts           # Root component
│
├── environments/
│   ├── environment.ts           # Dev: apiUrl, featureFlags
│   └── environment.production.ts
│
├── index.html       # Bootstrap HTML (loads Material Icons from Google CDN)
├── main.ts          # Angular bootstrap
└── styles.scss      # Global CSS variables, glass-panel, theme tokens, scrollbars
```

---

## Design System

The app uses a **glassmorphism** design aligned with `dtp-resender-fullstack/new_frontend`.

### CSS Variables (in `styles.scss`)

| Variable | Dark | Light | Purpose |
|----------|------|-------|---------|
| `--accent-color` | `#818cf8` (indigo) | `#4f46e5` | Buttons, active states, glow |
| `--bg-gradient-start` | `#0f172a` | `#f4f7ff` | Body gradient start |
| `--bg-gradient-end` | `#1e1b4b` | `#e9eefc` | Body gradient end |
| `--text-main` | `#f8fafc` | `#0f172a` | Body text |
| `--text-muted` | `#94a3b8` | `#475569` | Labels, secondary text |
| `--card-bg` | `rgba(255,255,255,0.03)` | `rgba(255,255,255,0.82)` | Glass panel backgrounds |
| `--card-border` | `rgba(255,255,255,0.1)` | `rgba(15,23,42,0.08)` | Glass panel borders |
| `--header-bg` | `rgba(15,23,42,0.68)` | `rgba(255,255,255,0.72)` | Sticky header background |
| `--success` | `#10b981` | same | Success states |
| `--warning` | `#f59e0b` | same | Warning states |
| `--error` | `#ef4444` | same | Error states |

### `.glass-panel` Utility Class (global)

```scss
.glass-panel {
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: 20px;
  backdrop-filter: blur(14px);
  box-shadow: 0 8px 26px rgba(15, 23, 42, 0.06);
  transition: border-color, box-shadow, transform 0.28s ease;
}
.glass-panel:hover {
  border-color: var(--card-hover-border);
  box-shadow: 0 12px 30px var(--glow-color);
}
```

### Theme Toggling

`ThemeService` in `core/theme.service.ts` applies `body.light-theme` or `body.dark-theme` CSS class. Components use `:host-context(body.light-theme)` selectors for theme-aware styles.

---

## Shared Component Library

### GlassButtonComponent — `app-glass-button`

```html
<app-glass-button variant="primary" size="medium" [loading]="isLoading" (clicked)="onSubmit()">
  <span class="material-icons">search</span> Search
</app-glass-button>
```

| Input | Type | Values | Default |
|-------|------|--------|---------|
| `variant` | string | `primary`, `secondary`, `tertiary`, `danger`, `icon` | `primary` |
| `size` | string | `small`, `medium`, `large` | `medium` |
| `disabled` | boolean | | `false` |
| `loading` | boolean | Shows spinner, hides content | `false` |
| `type` | string | `button`, `submit`, `reset` | `button` |

---

### GlassInputComponent — `app-glass-input`

Implements `ControlValueAccessor` — works with `ngModel` and reactive forms.

```html
<app-glass-input
  label="Lot IDs"
  placeholder="LOT123, LOT124"
  prefixIcon="search"
  [(ngModel)]="lotsRaw">
</app-glass-input>
```

---

### GlassSelectComponent — `app-glass-select`

Custom dropdown using CDK Overlay. Implements `ControlValueAccessor`. Keyboard navigable (arrow keys, Enter, Escape, letter-jump).

```html
<app-glass-select
  label="Environment"
  placeholder="Select environment"
  prefixIcon="dataset"
  [options]="envOptions"
  [(ngModel)]="selectedEnv">
</app-glass-select>
```

`options` accepts `string[]` or `{value: any, label: string}[]`.

---

### GlassIconComponent — `app-glass-icon`

SVG icon component. Named icons: `search`, `add`, `close`, `check`, `refresh`, `calendar`, `clock`, `dashboard`, `people`, `history`, `settings`, `info`, `warning`, `error`, `check_circle`, `download`, `upload`, `edit`, `delete`, `filter`, `sensors`, `timeline`.

```html
<app-glass-icon name="check_circle" [size]="24" color="success"></app-glass-icon>
```

Colors: `default`, `primary`, `success`, `warning`, `error`, `muted`.

---

### ActivityFeedComponent — `app-activity-feed`

```html
<app-activity-feed [events]="activityEvents"></app-activity-feed>
```

`events` input expects `ActivityEvent[]`:
```typescript
interface ActivityEvent {
  id: string;
  type: 'file' | 'lot' | 'session';
  message: string;
  timestamp: string;   // ISO string
  icon: string;        // GlassIconComponent name
  color: 'primary' | 'success' | 'warning' | 'error' | 'muted' | 'default';
}
```

Auto-scrolls to bottom when new events arrive. Pauses auto-scroll if user manually scrolls up.

---

### ToastService + ToastContainerComponent

```typescript
// Inject service
constructor(private toast: ToastService) {}

// Show toasts
this.toast.success('Session created');
this.toast.error('Archive search failed');
this.toast.info('Loading environments...');
this.toast.warning('3 lots not found');
```

`app-toast-container` is placed once in `app.html`. Toasts auto-dismiss (configurable).

---

### GlassLoadingOverlay — `glass-loading-overlay`

```html
<glass-loading-overlay [visible]="loading" message="Searching archive..." subtext="This may take a moment"></glass-loading-overlay>
```

---

## Authentication Flow

1. User navigates to `/xfcs` → `authGuard` redirects to `/login` if no token in `localStorage`
2. `login.component.ts` submits credentials to `POST /resender/api/auth/login`
3. Response includes JWT token → stored in `localStorage` via `AuthService`
4. `auth.interceptor.ts` automatically attaches `Authorization: Bearer <token>` to all outbound requests
5. On logout: token cleared, router navigates to `/login`

---

## API Service

`XfcsApiService` in `src/app/api/xfcs-api.service.ts` wraps all backend calls:

```typescript
// Environment list
getEnvs(): Observable<EnvYearRange[]>

// Archive search
searchArchive(criteria: SearchCriteria): Observable<SearchResult[]>

// File download (returns blob)
downloadFiles(req: DownloadFilesRequest): Observable<HttpResponse<Blob>>

// Reload session management
createReload(req: ReloadRequest): Observable<ReloadSession>
getReloadStatus(sessionId: string): Observable<ReloadStatus>
getReloadEvents(sessionId: string): Observable<ReloadSessionEvent[]>

// Dashboard + env info
getDashboard(): Observable<DashboardData>
getEnvInfo(environment: string): Observable<EnvInfo>
findArchiveLots(env: string, lot?: string, wafer?: string): Observable<ArchiveLotDetail[]>
```

---

## Routing

| Path | Component | Guards |
|------|-----------|--------|
| `/` | → redirect `/xfcs` | — |
| `/xfcs` | `XfcsComponent` | `authGuard`, `xfcsFeatureGuard` |
| `/login` | `LoginComponent` | — |
| `**` | → redirect `/xfcs` | — |

`xfcsFeatureGuard` returns `environment.featureFlags.xfcsReloaderEnabled`. Feature can be disabled per environment without code changes.

---

## Proxy Config

`proxy.conf.json` in the frontend root handles dev server proxying:

```json
{
  "/resender/api": { "target": "http://localhost:8080" },
  "/xfcs-reloader/api": { "target": "http://localhost:8005" }
}
```

---

## Build & Run

```powershell
# Navigate to frontend directory
cd c:\Users\fg8n8x\Desktop\eta\xfcs-reloader-fullstack\frontend

# Install dependencies (first time)
npm install

# Run dev server (port 4200 with proxy)
npm start
# → Angular dev server at http://localhost:4200
# → API requests proxied to :8080 (auth) and :8005 (XFCS)

# Production build (outputs to dist/)
npm run build:prod:subpath
# base-href is /xfcs-reloader/ for nginx routing

# Run tests (Karma/Jasmine)
npm test
```

---

## Adding New Features

### New API call
1. Add model interface(s) to `src/app/api/xfcs-models.ts`
2. Add method to `XfcsApiService`
3. Call from component; handle `next` and `error` cases

### New page/route
1. Create component in appropriate subfolder
2. Register route in `app.routes.ts` with `loadComponent`
3. Add nav link to `app.html` if needed

### New dialog
1. Create component that uses `@Inject(MAT_DIALOG_DATA)` for input data
2. Open from parent: `this.dialog.open(MyDialogComponent, { width: '700px', data: {...} })`
3. Style with `.mat-mdc-dialog-container .mdc-dialog__surface` overrides in `styles.scss`

### New shared component
- Place in `src/app/shared/components/`
- Use `standalone: true` with explicit `imports: []`
- Export the class (not a module)
- Use `:host-context(body.light-theme)` for theme variants
- Copy the pattern from any existing glass component

---

## Key Conventions

- **All components are standalone** — no `NgModule`, use `imports: [...]` directly
- **Use Angular signals** for internal state (`signal()`, `computed()`) where possible
- **Template safety**: use `| async` with Observables in templates; unwrap with `as user`
- **No Material form components** — use glass-input / glass-select exclusively
- **Error handling**: always provide `error` callback in `.subscribe({next, error})`; add to activity feed
- **Never hardcode environment values** — use `environment.ts` for API URLs, flags

---

## Environment Files

```typescript
// src/environments/environment.ts (dev)
export const environment = {
  production: false,
  apiUrl: '/xfcs-reloader/api',
  featureFlags: {
    xfcsReloaderEnabled: true
  }
};
```

For production builds: `ng build --configuration production` swaps to `environment.production.ts`.
