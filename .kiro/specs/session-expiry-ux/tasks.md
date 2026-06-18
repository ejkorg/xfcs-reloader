# Implementation Plan: Session Expiry UX

## Overview

Introduce a two-phase session expiry UX (warning modal + expired modal) to xfcs-reloader-fullstack, along with the `GlassDialogService` needed to power it. Modeled after the dtp-resender-fullstack implementation.

## Tasks

- [x] 1. Introduce GlassDialogService and GLASS_DIALOG_DATA token
  - Create `src/app/shared/services/glass-dialog.service.ts`
  - Implement `GlassDialogConfig`, `GlassDialogRef`, and `GlassDialogService` using `createComponent` + `ApplicationRef`
  - Create `GLASS_DIALOG_DATA` injection token in `src/app/shared/services/glass-dialog-data.token.ts`
  - Add `.glass-dialog-overlay` and `.glass-dialog-panel` styles to `styles.scss`
  - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [ ]* 1.1 Write property test for dialog close round-trip (Property 6)
  - **Property 6: Dialog close round-trip**
  - **Validates: Requirements 5.3, 5.4**

- [ ]* 1.2 Write unit tests for GlassDialogService
  - Test `open()` appends overlay to DOM
  - Test `close()` removes overlay from DOM
  - Test `disableClose: true` prevents backdrop dismissal
  - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [x] 2. Create SessionExpiryService
  - Create `src/app/auth/session-expiry.service.ts`
  - Implement `warning$` and `expired$` observables using `Subject`
  - Implement `scheduleWarning(token)` — parse JWT exp, schedule `timer()` at `exp - 120s`
  - Implement `cancelWarning()` — unsubscribe timer
  - Implement `notifyExpired()` — emit `expired$`
  - Implement singleton guard (`modalOpen` flag) to prevent duplicate modals
  - Wire `warning$` → open `SessionWarningModalComponent` via `GlassDialogService`
  - Wire `expired$` → close any open warning modal, open `SessionExpiredModalComponent`
  - _Requirements: 1.1, 2.1, 2.2, 2.7, 4.1, 4.2, 4.3_

- [ ]* 2.1 Write property test for warning threshold (Property 1)
  - **Property 1: Warning threshold fires within correct window**
  - **Validates: Requirements 1.1**

- [ ]* 2.2 Write property test for modal singleton guard (Property 4)
  - **Property 4: Modal singleton — no stacking on repeated events**
  - **Validates: Requirements 2.7, 4.2**

- [ ]* 2.3 Write property test for modal reopen after close (Property 7)
  - **Property 7: Modal reopen after close**
  - **Validates: Requirements 4.3**

- [x] 3. Create SessionWarningModalComponent
  - Create `src/app/auth/session-warning-modal.component.ts`
  - Inject `GLASS_DIALOG_DATA` to receive `secondsRemaining`
  - Implement `setInterval` countdown decrement (1000ms)
  - Implement `formatCountdown(s: number): string` — pure function returning `MM:SS`
  - On "Stay Logged In": call `AuthService.refresh()`, close modal on success, show toast
  - On "Log Out": call `AuthService.logout()`
  - On countdown = 0: close self, call `SessionExpiryService.notifyExpired()`
  - Subscribe to `AuthService.token$` — close automatically on new token (background refresh)
  - Use `glass-panel` styling consistent with existing modals
  - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 6.1, 6.3_

- [ ]* 3.1 Write property test for MM:SS formatter (Property 2)
  - **Property 2: MM:SS formatter correctness**
  - **Validates: Requirements 1.3**

- [ ]* 3.2 Write unit tests for SessionWarningModalComponent
  - Test countdown decrement via fakeAsync/tick
  - Test "Stay Logged In" calls refresh and closes modal
  - Test "Log Out" calls logout
  - Test auto-close on new token from token$
  - _Requirements: 1.4, 1.5, 1.6, 1.8_

- [x] 4. Create SessionExpiredModalComponent
  - Create `src/app/auth/session-expired-modal.component.ts`
  - Display expired message with lock icon
  - On "Log In Again": call `AuthService.clearSession()`, navigate to `/login?returnUrl=<currentUrl>`
  - Use `glass-panel` styling consistent with existing modals
  - _Requirements: 2.3, 2.4, 2.5, 6.2, 6.4_

- [ ]* 4.1 Write unit tests for SessionExpiredModalComponent
  - Test "Log In Again" calls clearSession and navigates with returnUrl
  - Test returnUrl is correctly encoded in query param
  - _Requirements: 2.4, 3.1_

- [x] 5. Checkpoint — Ensure all tests pass, ask the user if questions arise.

- [x] 6. Update AuthService
  - Expose `token$` as `BehaviorSubject<string | null>` (make existing private `accessToken` reactive)
  - Add `clearSession()` public method (clears token/storage/user state without router navigation)
  - In `setSession(token)`: call `SessionExpiryService.scheduleWarning(token)` when token is non-null
  - In `setSession(null)`: call `SessionExpiryService.cancelWarning()`
  - _Requirements: 1.8, 2.4_

- [x] 7. Update AuthInterceptor
  - Inject `SessionExpiryService`
  - Replace `auth.logout()` on 401 with `sessionExpiryService.notifyExpired()`
  - _Requirements: 2.1_

- [ ]* 7.1 Write property test for 401 routing (Property 3)
  - **Property 3: 401 responses always emit expired event**
  - **Validates: Requirements 2.1**

- [x] 8. Update LoginComponent
  - Inject `ActivatedRoute`
  - After successful login, read `returnUrl` from query params
  - Implement safety check: navigate to `returnUrl` only if it starts with `/` and does not contain `://`; otherwise navigate to `/dashboard`
  - _Requirements: 3.2, 3.3_

- [ ]* 8.1 Write property test for returnUrl safety (Property 5)
  - **Property 5: returnUrl safety — only relative internal paths are accepted**
  - **Validates: Requirements 3.2, 3.3**

- [ ]* 8.2 Write unit tests for LoginComponent returnUrl handling
  - Test valid returnUrl navigates correctly
  - Test absolute URL falls back to /dashboard
  - Test null/empty returnUrl falls back to /dashboard
  - _Requirements: 3.2, 3.3_

- [x] 9. Final checkpoint — Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- `fast-check` is the PBT library — install with `npm install --save-dev fast-check`
- Property tests run minimum 100 iterations each
- `GlassDialogService` uses Angular's `createComponent` API (no CDK dependency)
