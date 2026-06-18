# SSO Integration Implementation Summary

## Problem
The xFCS Reloader login page was displaying only basic username/password authentication without any SSO (Single Sign-On) button or link to the Exensio auth service at `https://usaz15ls088:8080/exensio-reload`.

## Root Cause
The frontend had complete SSO infrastructure built and ready, but **no backend authentication endpoints existed**. The frontend was expecting the following endpoints that were missing:
- `GET /api/auth/config` - Returns whether SSO is enabled
- `GET /api/auth/sso/initiate` - Initiates SSO redirect
- `GET /api/auth/sso/silent` - Attempts silent SSO
- `POST /api/auth/login` - Local credential login
- `POST /api/auth/refresh` - Token refresh
- `GET /api/auth/me` - Get current user info
- `POST /api/auth/sso/callback` - Handle SSO callback

## Solution Implemented

### 1. Backend: AuthController
**File:** `backend/src/main/java/com/onsemi/cim/apps/exensio/xfcsreloader/web/AuthController.java`

Created a new REST controller providing all required authentication endpoints:

#### Endpoints
- **GET `/api/auth/config`** - Returns `{ ssoEnabled: true }` to enable SSO on frontend
- **GET `/api/auth/sso/initiate`** - Redirects to Exensio auth service with callback URL
- **GET `/api/auth/sso/silent`** - Attempts silent authentication (returns 204 No Content)
- **POST `/api/auth/login`** - Validates credentials and returns JWT token
- **POST `/api/auth/refresh`** - Handles token refresh (stateless implementation)
- **GET `/api/auth/me`** - Returns current user info from JWT claims
- **POST `/api/auth/sso/callback`** - Validates SSO token from Exensio and returns it

#### Configuration Properties
Added new properties to `application.yml`:
```yaml
sso:
  enabled: ${SSO_ENABLED:true}
  exensio-auth-url: ${SSO_EXENSIO_AUTH_URL:https://usaz15ls088:8080/exensio-reload/auth}
  callback-url: ${SSO_CALLBACK_URL:http://localhost:4200/sso-callback}
```

### 2. Backend: JwtUtil Enhancement
**File:** `backend/src/main/java/com/onsemi/cim/apps/exensio/xfcsreloader/config/JwtUtil.java`

Added new methods to support token generation and claims extraction:
- **`generateToken(username, roles)`** - Creates JWT token with 1-hour expiry
- **`generateToken(username, roles, expirationMs)`** - Creates JWT with custom expiry
- **`getTokenClaims(token)`** - Extracts all claims from token as Map

### 3. Frontend: Environment Configuration
**File:** `frontend/src/environments/environment.ts`

Updated auth URL to point to the new backend endpoints:
```typescript
authUrl: '/xfcs-reloader/api/auth'  // Was: '/exensio-reload/api/auth'
```

### 4. Frontend: Login Component Fix
**File:** `frontend/src/app/auth/login.component.ts`

Fixed hardcoded SSO redirect URL to use environment configuration:
```typescript
// Before: `/resender/api/auth/sso/initiate?returnUrl=...`
// After: `${environment.authUrl}/sso/initiate?returnUrl=...`
```

## How It Works

1. **App Initialization**
   - Frontend's `APP_INITIALIZER` calls `GET /api/auth/config`
   - Backend returns `{ ssoEnabled: true }`
   - Frontend sets `auth.ssoEnabled()` signal to true

2. **Login Page Rendering**
   - If `auth.ssoEnabled()` is true, SSO button appears above credential form
   - Button displays "Sign in with onsemi SSO"

3. **SSO Login Flow**
   - User clicks SSO button
   - Frontend redirects to `GET /api/auth/sso/initiate?returnUrl=/dashboard`
   - Backend redirects to Exensio auth service with callback URL
   - User authenticates with Exensio
   - Exensio redirects back to `/sso-callback` with JWT token
   - Frontend's SsoCallbackComponent validates token and logs in user

4. **Credential Login Flow**
   - User enters username/password and clicks "Authenticate"
   - Frontend posts to `POST /api/auth/login` with credentials
   - Backend validates and returns JWT token
   - Frontend stores token and redirects to dashboard

## Security Considerations

- JWT tokens are validated using the secret configured in `reloader.jwt.secret`
- Tokens expire after 1 hour
- SSO callback includes return URL validation to prevent open redirects
- CORS is properly configured to allow frontend origins
- All auth endpoints allow public access; JWT validation protects API endpoints

## Testing the Integration

### Manual Testing
1. Access login page at `https://usaz15ls088:8080/xfcs-reloader/login`
2. Verify SSO button appears
3. Click "Sign in with onsemi SSO"
4. Verify redirect to Exensio auth service
5. Complete Exensio authentication
6. Verify redirect back and successful login

### Or Use Credentials
1. Click "Authenticate" with test credentials
2. Verify JWT token is issued and stored
3. Verify redirect to dashboard

## Configuration

### Production Setup
Set these environment variables on the backend:
```bash
SSO_ENABLED=true
SSO_EXENSIO_AUTH_URL=https://usaz15ls088:8080/exensio-reload/auth
SSO_CALLBACK_URL=https://your-frontend-host/sso-callback
RELOADER_JWT_SECRET=<secure-32-byte-key-base64-encoded>
```

### Frontend Setup
No changes needed if backend is at the same host. If different:
1. Update `frontend/src/environments/environment.ts`
2. Ensure CORS allows the frontend origin in `security.allowed-origins`

## Files Modified

### Backend
1. ✅ Created: `backend/src/main/java/com/onsemi/cim/apps/exensio/xfcsreloader/web/AuthController.java`
2. ✅ Updated: `backend/src/main/java/com/onsemi/cim/apps/exensio/xfcsreloader/config/JwtUtil.java`
3. ✅ Updated: `backend/src/main/resources/application.yml`

### Frontend
1. ✅ Updated: `frontend/src/environments/environment.ts`
2. ✅ Updated: `frontend/src/app/auth/login.component.ts`

## Next Steps

1. **Build and Deploy**
   - Run backend build: `mvn clean package`
   - Run frontend build: `ng build`

2. **Test SSO Flow**
   - Verify Exensio auth service is accessible
   - Test both SSO and credential login paths

3. **Monitor Logs**
   - Check backend logs for auth endpoint calls
   - Verify token validation working correctly

4. **Optional Enhancements**
   - Integrate with actual Exensio credential validation service
   - Add logout endpoint to revoke tokens
   - Implement refresh token rotation for enhanced security
