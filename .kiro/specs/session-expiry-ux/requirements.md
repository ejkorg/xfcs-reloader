# Requirements Document

## Introduction

This feature adds industry-standard session expiry UX to the xFCS Reloader frontend. Currently, when a JWT access token expires and the backend returns a 401, the app silently calls `auth.logout()` in the interceptor, which clears state and hard-redirects to `/login` with no user feedback. This is disorienting — users lose unsaved work with no warning.

The improved experience introduces:
1. A **proactive warning modal** shown ~2 minutes before the session expires, giving the user a chance to extend it.
2. A **session-expired modal** shown when the session has already expired (401 received or token fully expired), allowing the user to log back in without losing their current URL context.
3. A **toast notification** as a secondary signal for the warning state.

Both modals follow the existing glassmorphism design system (`glass-panel`, `ToastService`). Because xFCS Reloader does not yet have a `GlassDialogService`, this feature will also introduce a lightweight `GlassDialogService` consistent with the one in `dtp-resender-fullstack`.

## Glossary

- **AuthService**: The Angular service managing JWT access tokens, refresh scheduling, and user state.
- **AuthInterceptor**: The Angular HTTP interceptor that attaches Bearer tokens and handles 401 responses.
- **SessionExpiryService**: New service responsible for tracking token expiry time, emitting warning and expired events, and coordinating modal display.
- **SessionWarningModalComponent**: New modal component shown ~2 minutes before session expiry with a countdown and "Stay Logged In" / "Log Out" actions.
- **SessionExpiredModalComponent**: New modal component shown when the session has fully expired, with a "Log In Again" action that preserves the current URL as a `returnUrl`.
- **GlassDialogService**: New lightweight dialog service (to be introduced by this feature) used to open modals programmatically, consistent with the dtp-resender implementation.
- **ToastService**: Existing service for showing transient notifications.
- **Access Token**: Short-lived JWT stored in `sessionStorage` and `localStorage`, refreshed automatically before expiry.
- **Refresh Token**: HTTP-only cookie used by the backend to issue new access tokens via `/auth/refresh`.
- **returnUrl**: The URL the user was on when their session expired, stored as a query param on `/login` so they are redirected back after re-authentication.
- **Warning Threshold**: The time before token expiry at which the warning modal is shown (default: 2 minutes / 120 seconds).

---

## Requirements

### Requirement 1: Proactive Session Warning

**User Story:** As a logged-in user, I want to be warned before my session expires, so that I can choose to stay logged in and avoid losing my work.

#### Acceptance Criteria

1. WHEN the access token has less than 120 seconds remaining before expiry, THE SessionExpiryService SHALL emit a session-warning event.
2. WHEN a session-warning event is emitted, THE SessionWarningModalComponent SHALL be displayed as a modal overlay with a live countdown timer showing seconds remaining.
3. WHILE the SessionWarningModalComponent is visible, THE countdown timer SHALL decrement every second and display the remaining time in `MM:SS` format.
4. WHEN the user clicks "Stay Logged In" in the SessionWarningModalComponent, THE SessionExpiryService SHALL call the token refresh endpoint and close the modal on success.
5. WHEN the token refresh succeeds after clicking "Stay Logged In", THE SessionWarningModalComponent SHALL close and THE ToastService SHALL display a success notification confirming the session was extended.
6. WHEN the user clicks "Log Out" in the SessionWarningModalComponent, THE AuthService SHALL perform a logout and navigate to `/login`.
7. WHEN the countdown reaches zero while the SessionWarningModalComponent is still open, THE SessionWarningModalComponent SHALL automatically transition to the SessionExpiredModalComponent.
8. IF the session is successfully refreshed by the background auto-refresh timer while the SessionWarningModalComponent is open, THEN THE SessionWarningModalComponent SHALL close automatically.
9. THE SessionWarningModalComponent SHALL be displayed with `disableClose: true` so the user cannot dismiss it by clicking the backdrop or pressing Escape.

---

### Requirement 2: Session Expired Modal

**User Story:** As a user whose session has expired, I want a clear explanation and a direct path to log back in, so that I am not confused by a silent redirect.

#### Acceptance Criteria

1. WHEN the AuthInterceptor receives a 401 HTTP response, THE SessionExpiryService SHALL emit a session-expired event instead of calling `auth.logout()` directly.
2. WHEN a session-expired event is emitted and no modal is currently open, THE SessionExpiredModalComponent SHALL be displayed as a modal overlay.
3. THE SessionExpiredModalComponent SHALL display a clear message explaining the session has expired.
4. WHEN the user clicks "Log In Again" in the SessionExpiredModalComponent, THE AuthService SHALL clear the session, and THE Router SHALL navigate to `/login` with the current URL preserved as a `returnUrl` query parameter.
5. THE SessionExpiredModalComponent SHALL be displayed with `disableClose: true` so the user cannot dismiss it without taking action.
6. IF a session-expired event is emitted while the SessionWarningModalComponent is already open, THEN THE SessionWarningModalComponent SHALL be replaced by the SessionExpiredModalComponent without stacking two modals.
7. IF a session-expired event is emitted while the SessionExpiredModalComponent is already open, THEN THE SessionExpiryService SHALL ignore the duplicate event and not open a second modal.

---

### Requirement 3: Return URL Preservation

**User Story:** As a user who was redirected to login due to session expiry, I want to be returned to the page I was on after logging in, so that I can continue my work without navigating manually.

#### Acceptance Criteria

1. WHEN the SessionExpiredModalComponent navigates to `/login`, THE Router SHALL include the user's current URL as a `returnUrl` query parameter (e.g., `/login?returnUrl=%2Fdashboard`).
2. WHEN a user successfully logs in and a `returnUrl` query parameter is present, THE LoginComponent SHALL navigate to the `returnUrl` after successful authentication.
3. IF the `returnUrl` is an absolute URL or points outside the application, THEN THE LoginComponent SHALL ignore it and navigate to the default route `/dashboard`.

---

### Requirement 4: Single Modal Instance Guard

**User Story:** As a developer, I want the session expiry modals to be singletons, so that multiple concurrent 401 responses or timer firings do not stack duplicate modals.

#### Acceptance Criteria

1. THE SessionExpiryService SHALL track whether a warning or expired modal is currently open using an internal boolean flag.
2. WHEN a session-warning or session-expired event is triggered while a modal is already open, THE SessionExpiryService SHALL not open an additional modal.
3. WHEN a modal is closed for any reason, THE SessionExpiryService SHALL reset the open flag so future events can trigger a new modal.

---

### Requirement 5: GlassDialogService Introduction

**User Story:** As a developer, I want a reusable programmatic dialog service consistent with the dtp-resender implementation, so that session modals and future dialogs can be opened without coupling to Angular Material's CDK directly.

#### Acceptance Criteria

1. THE GlassDialogService SHALL provide an `open(component, config)` method that renders a component inside a glassmorphism-styled overlay.
2. WHEN `disableClose: true` is passed in the config, THE GlassDialogService SHALL prevent the overlay from being dismissed by backdrop click or Escape key.
3. THE GlassDialogService SHALL return a dialog reference object with a `close()` method that removes the overlay from the DOM.
4. WHEN a dialog is closed via the reference `close()` method, THE GlassDialogService SHALL emit a closed event so subscribers can react.

---

### Requirement 6: Design System Consistency

**User Story:** As a user, I want the session expiry modals to match the existing application visual style, so that the experience feels cohesive.

#### Acceptance Criteria

1. THE SessionWarningModalComponent SHALL use the existing `glass-panel` CSS class and glassmorphism styling consistent with other modals in the application.
2. THE SessionExpiredModalComponent SHALL use the existing `glass-panel` CSS class and glassmorphism styling consistent with other modals in the application.
3. THE SessionWarningModalComponent SHALL use the GlassDialogService to be opened programmatically.
4. THE SessionExpiredModalComponent SHALL use the GlassDialogService to be opened programmatically.
5. WHEN displayed on screens narrower than 768px, THE SessionWarningModalComponent and SessionExpiredModalComponent SHALL be responsive and fully usable on mobile viewports.
