# Requirements Document

## Introduction

This feature adds Single Sign-On (SSO) login support for onsemi.com corporate users in the XFCS Reloader application. XFCS Reloader currently delegates authentication entirely to the DTP Resender backend (`/resender/api/auth/*`) — DTP remains the token issuer and XFCS validates the resulting JWT. SSO must be introduced in a way that is consistent with the SSO implementation in DTP Resender: the same IdP, the same token lifecycle, and the same session behavior. The existing local login path must remain functional for service accounts and non-SSO users.

## Glossary

- **SSO**: Single Sign-On — a session/user authentication scheme that allows a user to log in once and gain access to multiple systems.
- **IdP**: Identity Provider — the onsemi corporate identity system (Azure AD / Entra ID) that authenticates users.
- **SP**: Service Provider — in this context, the DTP Resender backend, which is the sole token issuer for both DTP and XFCS.
- **OIDC**: OpenID Connect — the identity layer used over OAuth 2.0 to verify user identity via the IdP.
- **Access Token**: A short-lived JWT issued by the DTP Resender backend after successful authentication (local or SSO), validated by the XFCS backend.
- **Refresh Token**: A long-lived opaque token stored in an HTTP-only cookie, managed by the DTP Resender backend.
- **JIT Provisioning**: Just-In-Time user provisioning — automatically creating a local user record on first SSO login (handled by DTP backend, shared schema).
- **AuthService**: The Angular service in the XFCS frontend responsible for managing authentication state.
- **DTP AuthController**: The Spring Boot REST controller in the DTP Resender backend that handles all authentication endpoints, including SSO callbacks.
- **XFCS SecurityConfig**: The Spring Boot security configuration in the XFCS backend that validates JWTs issued by DTP.
- **AppUser**: The shared user entity stored in the common database schema, managed by the DTP backend.

## Requirements

### Requirement 1: SSO Login Entry Point

**User Story:** As an onsemi employee, I want to click a "Sign in with onsemi SSO" button on the XFCS Reloader login page, so that I can authenticate using my corporate credentials without entering a separate username and password.

#### Acceptance Criteria

1. THE Login_Page SHALL display a clearly labeled "Sign in with onsemi SSO" button alongside the existing username/password form.
2. WHEN a user clicks the SSO button, THE Login_Page SHALL redirect the user's browser to the DTP Resender SSO initiation URL (e.g., `/resender/api/auth/sso/initiate`), which in turn redirects to the IdP.
3. WHEN the SSO button is clicked, THE Login_Page SHALL preserve any `returnUrl` query parameter so the user is redirected to the correct XFCS page after authentication.
4. WHILE the SSO redirect is in progress, THE Login_Page SHALL display a loading indicator to prevent duplicate clicks.

---

### Requirement 2: SSO Callback Handling via DTP Backend

**User Story:** As the system, I want the DTP Resender backend to handle the IdP callback and issue tokens that the XFCS frontend can consume, so that XFCS does not need its own IdP integration.

#### Acceptance Criteria

1. WHEN the IdP redirects back after a successful SSO authentication, THE DTP_AuthController SHALL process the callback and issue a JWT access token and HTTP-only refresh token cookie using the same mechanism as local login.
2. WHEN the DTP_AuthController issues a token after SSO, THE DTP_AuthController SHALL redirect the browser to the XFCS frontend callback URL with the access token, so the XFCS AuthService can initialize the session.
3. WHEN the IdP assertion is invalid or expired, THE DTP_AuthController SHALL redirect the browser to the XFCS login page with a descriptive error query parameter.
4. THE XFCS_SecurityConfig SHALL accept and validate JWT tokens issued by the DTP backend for SSO-authenticated users, using the same validation logic as for locally-authenticated users.

---

### Requirement 3: Just-In-Time User Provisioning

**User Story:** As an onsemi employee logging in via SSO for the first time, I want my account to be created automatically in the shared database, so that I can access XFCS Reloader without a separate registration step.

#### Acceptance Criteria

1. WHEN a valid SSO assertion is received for a user whose email does not exist in the shared AppUser table, THE DTP_AuthController SHALL create a new AppUser record with the corporate email as the username.
2. WHEN a new AppUser is created via JIT provisioning, THE System SHALL assign the default role `USER` to the new account.
3. WHEN a valid SSO assertion is received for a user who already exists in the shared AppUser table, THE DTP_AuthController SHALL use the existing account without modifying it.
4. WHEN a JIT-provisioned user account is created, THE System SHALL mark the account as enabled and set a null or unusable password to prevent local password login.
5. IF JIT provisioning fails due to a database error, THEN THE DTP_AuthController SHALL redirect the browser to the XFCS login page with an error parameter and log the error with sufficient detail for diagnosis.

---

### Requirement 4: Role Mapping from IdP Claims

**User Story:** As a system administrator, I want SSO users' roles to be derived from IdP group claims, so that access control in XFCS Reloader is consistent with corporate group membership.

#### Acceptance Criteria

1. WHEN the IdP assertion contains group or role claims, THE DTP_AuthController SHALL map configured IdP group names to local application roles (e.g., `onsemi-xfcs-admins` → `ADMIN`).
2. WHEN no matching group claim is found in the IdP assertion, THE DTP_AuthController SHALL assign the default role `USER` to the authenticated user.
3. WHEN a role mapping is configured, THE System SHALL apply it at every SSO login, updating the user's roles if IdP group membership has changed.
4. THE System SHALL support configuring IdP-to-role mappings for XFCS via application properties without requiring code changes.

---

### Requirement 5: Session Continuity and Token Lifecycle

**User Story:** As an authenticated SSO user, I want my XFCS session to behave identically to a local login session, so that token refresh, expiry warnings, and logout work consistently.

#### Acceptance Criteria

1. WHEN an SSO user's access token is within 30 seconds of expiry, THE AuthService SHALL silently refresh it using the existing `/resender/api/auth/refresh` endpoint.
2. WHEN an SSO user's refresh token expires, THE System SHALL display the session expiry warning modal and redirect to the XFCS login page on expiry.
3. WHEN an SSO user clicks logout, THE AuthService SHALL call the DTP logout endpoint to revoke the refresh token and clear the HTTP-only cookie, identical to local logout behavior.
4. WHILE an SSO session is active, THE AuthService SHALL expose the user's username and roles through the same `currentUser` signal used by local login sessions.

---

### Requirement 6: Automatic / Silent SSO

**User Story:** As an onsemi employee who is already signed into my corporate account, I want the XFCS Reloader application to authenticate me automatically when I open it, so that I do not need to click any login button.

#### Acceptance Criteria

1. WHEN the XFCS application loads and no local session exists, THE AuthService SHALL attempt a silent OIDC authentication by calling the DTP silent SSO check endpoint.
2. WHEN the silent OIDC check succeeds, THE System SHALL establish a full session (JWT + refresh cookie) and navigate the user directly to the XFCS application without displaying the login page.
3. WHEN the silent OIDC check fails because no Azure AD session exists, THE System SHALL display the XFCS login page without showing an error.
4. WHEN the silent OIDC check does not complete within 5 seconds, THE System SHALL cancel the attempt and display the XFCS login page.
5. WHERE SSO is disabled via configuration, THE AuthService SHALL skip the silent SSO attempt entirely.

---

### Requirement 7: Fallback to Local Login

**User Story:** As a service account or non-onsemi user, I want the existing username/password login to remain available in XFCS Reloader, so that automated processes and non-SSO users are not disrupted.

#### Acceptance Criteria

1. THE Login_Page SHALL continue to display the username/password form alongside the SSO button.
2. WHEN a user submits the username/password form, THE AuthService SHALL authenticate using the existing DTP local credential flow (`/resender/api/auth/login`), unaffected by the SSO configuration.
3. WHERE SSO is disabled via configuration, THE Login_Page SHALL hide the SSO button and display only the local login form.
4. IF the SSO IdP is unreachable, THEN THE System SHALL display an error message on the XFCS login page and allow the user to fall back to local login.

---

### Requirement 8: Security and Configuration

**User Story:** As a security engineer, I want the SSO integration in XFCS Reloader to follow security best practices, so that the application is not vulnerable to open redirects, token leakage, or CSRF.

#### Acceptance Criteria

1. THE DTP_AuthController SHALL validate the IdP assertion signature using the IdP's public certificate or JWKS endpoint before trusting any claims.
2. THE System SHALL enforce a maximum assertion age of 5 minutes to prevent replay attacks.
3. WHEN processing the SSO callback, THE DTP_AuthController SHALL validate that the `state` parameter matches the value generated at login initiation to prevent CSRF.
4. THE System SHALL not expose the raw IdP assertion or authorization code to the XFCS frontend.
5. THE System SHALL configure all SSO-related settings (IdP metadata URL, client ID, client secret, certificate) exclusively via environment variables or application properties, with no hardcoded values.
6. WHEN a `returnUrl` is provided after SSO login, THE AuthService SHALL validate that it is a relative path within the XFCS application before redirecting, to prevent open redirect attacks.
