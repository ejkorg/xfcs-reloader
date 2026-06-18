# Implementation Plan: onsemi SSO Login — XFCS Reloader

## Overview

All changes are confined to the XFCS frontend. The XFCS backend requires no modifications. The DTP backend SSO work is tracked in the DTP SSO spec. Tasks here assume the DTP backend SSO endpoints (`/resender/api/auth/sso/initiate`, `/resender/api/auth/sso/silent`, `/resender/api/auth/config`) are already deployed or being deployed in parallel.

## Tasks

- [x] 1. Add auth config fetching and ssoEnabled signal to AuthService
  - Add `ssoEnabled = signal(false)` to `AuthService`
  - Add `loadAuthConfig(): Observable<void>` that calls `GET /resender/api/auth/config` and sets `ssoEnabled` from the response
  - _Requirements: 7.3, 6.5_

- [x] 1.1 Add handleSsoCallback and trySilentSso methods to AuthService
  - Add `handleSsoCallback(token: string): Observable<void>` — calls `setSession(token)` then `loadMe()`
  - Add `trySilentSso(returnUrl: string): void` — sets `window.location.href` to `/resender/api/auth/sso/silent?returnUrl=<encoded>` with a 5-second timeout guard that navigates to `/login` if not resolved
  - _Requirements: 2.2, 6.1, 6.4_

- [ ]* 1.2 Write property test for handleSsoCallback token round-trip
  - **Property 1: SSO callback token round-trip**
  - Generate random JWT-shaped strings, call `handleSsoCallback`, assert `getToken()` returns the same value
  - **Validates: Requirements 2.2, 5.4**

- [ ]* 1.3 Write property test for trySilentSso timeout fallback
  - **Property 2: Silent SSO timeout fallback**
  - Verify that when the 5-second timer fires before the redirect resolves, the router navigates to `/login`
  - **Validates: Requirements 6.4**

- [x] 2. Create SsoCallbackComponent
  - Create `auth/sso-callback.component.ts` as a standalone Angular component
  - Read `token` and `returnUrl` query params on init
  - If `token` is missing, navigate to `/login?reason=sso-error`
  - Call `authService.handleSsoCallback(token)`, then navigate to sanitized `returnUrl` (relative paths only, fallback `/dashboard`)
  - _Requirements: 2.2, 8.6_

- [ ]* 2.1 Write property test for open redirect prevention in SsoCallbackComponent
  - **Property 3: Open redirect prevention in SSO callback**
  - Generate arbitrary strings as `returnUrl`, assert only relative paths (starting with `/`, no `://`) pass through; all others map to `/dashboard`
  - **Validates: Requirements 8.6**

- [x] 3. Update LoginComponent to add SSO button and error display
  - Add "Sign in with onsemi SSO" button, rendered only when `authService.ssoEnabled()` is `true`
  - On click: set `loading = true`, then `window.location.href = '/resender/api/auth/sso/initiate?returnUrl=' + encodeURIComponent(getSafeReturnUrl())`
  - Add error display: if `reason=sso-error` is present in query params on load, show "SSO sign-in failed. Please try again or use local login."
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 7.3, 7.4_

- [ ]* 3.1 Write property test for SSO button visibility
  - **Property 4: SSO button visibility matches config**
  - For random boolean values of `ssoEnabled`, assert the SSO button is present in the DOM if and only if `ssoEnabled` is `true`
  - **Validates: Requirements 7.3**

- [ ]* 3.2 Write property test for returnUrl encoding in SSO initiation
  - **Property 5: returnUrl is encoded and preserved in SSO initiation URL**
  - Generate random relative path strings as `returnUrl`, assert they are URI-encoded and appended to the initiation URL
  - **Validates: Requirements 1.3**

- [x] 4. Wire APP_INITIALIZER and add /sso-callback route
  - In `app.config.ts`, add an `APP_INITIALIZER` factory that calls `authService.loadAuthConfig()` on startup
  - After config loads, if `ssoEnabled` is `true` and no local session exists, call `authService.trySilentSso(currentUrl)`
  - In `app.routes.ts`, add `{ path: 'sso-callback', component: SsoCallbackComponent }` (no auth guard)
  - _Requirements: 6.1, 6.2, 6.3, 6.5_

- [x] 5. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- The XFCS backend requires no changes — SSO JWTs are structurally identical to local-login JWTs
- DTP backend SSO endpoints must be deployed before these frontend changes are functional
- Property tests use [fast-check](https://fast-check.io/) as specified in the design
