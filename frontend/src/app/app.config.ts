import { APP_INITIALIZER, ApplicationConfig, inject, provideZoneChangeDetection } from '@angular/core';
import { provideRouter, Router } from '@angular/router';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';

import { routes } from './app.routes';
import { authInterceptor } from './auth/auth.interceptor';
import { AuthService } from './auth/auth.service';

/**
 * APP_INITIALIZER factory that:
 * 1. Fetches /resender/api/auth/config to populate the ssoEnabled signal.
 * 2. If SSO is enabled and no local session exists, initiates a silent SSO attempt.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.5
 */
function authInitializerFactory(): () => Promise<void> {
  const authService = inject(AuthService);
  const router = inject(Router);

  return () =>
    new Promise<void>((resolve) => {
      // Skip silent SSO when landing on the sso-callback page — the token is
      // in the URL query params and SsoCallbackComponent will process it.
      // Without this check, trySilentSso() would navigate away before the
      // callback component ever runs, losing the token and sending the user
      // through the SSO flow again.
      if (window.location.pathname.includes('/sso-callback')) {
        resolve();
        return;
      }

      authService.loadAuthConfig().subscribe({
        next: () => {
          // Requirement 6.5: skip silent SSO if SSO is disabled via config
          if (authService.ssoEnabled() && !authService.isAuthenticated()) {
            // Requirement 6.1: attempt silent SSO when no local session exists
            const currentUrl = router.url || window.location.pathname + window.location.search;
            authService.trySilentSso(currentUrl);
            // trySilentSso performs a full-page redirect; resolve so the app
            // can continue bootstrapping in case the redirect is delayed.
          }
          resolve();
        },
        error: () => resolve()
      });
    });
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideAnimationsAsync(),
    provideHttpClient(withFetch(), withInterceptors([authInterceptor])),
    {
      provide: APP_INITIALIZER,
      useFactory: authInitializerFactory,
      multi: true
    }
  ]
};
