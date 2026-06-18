import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Router } from '@angular/router';
import { BehaviorSubject, Observable, Subscription, timer, catchError, finalize, map, of, switchMap, throwError, tap } from 'rxjs';
import { environment } from '../../environments/environment';
import { SessionExpiryService } from './session-expiry.service';

interface AuthConfig {
  ssoEnabled: boolean;
}

export interface UserInfo {
  username: string;
  roles: string[];
}

interface LoginResponse {
  accessToken: string;
}

interface RefreshResponse {
  accessToken?: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  // Use inject with a forward reference to avoid circular dependency
  private readonly sessionExpiryService = inject(SessionExpiryService);

  private readonly authUrl = environment.authUrl;
  private accessToken: string | null = null;
  private refreshTimerSub: Subscription | null = null;

  private userSubject = new BehaviorSubject<UserInfo | null>(null);
  readonly user$ = this.userSubject.asObservable();
  currentUser = signal<UserInfo | null>(null);

  /** Reactive access token — emits whenever the token changes. */
  readonly token$ = new BehaviorSubject<string | null>(null);

  /** Whether SSO is enabled — populated from GET /resender/api/auth/config on app init. */
  readonly ssoEnabled = signal<boolean>(false);

  constructor() {
    const stored = sessionStorage.getItem('accessToken') || localStorage.getItem('auth_token');
    if (stored) {
      this.setSession(stored);
      this.loadMe().subscribe();
      return;
    }

    this.refresh().subscribe({
      next: (ok: boolean) => {
        if (ok) {
          this.loadMe().subscribe();
        }
      }
    });
  }

  login(credentials: { username: string; password: string }): Observable<void> {
    return this.http.post<LoginResponse>(`${this.authUrl}/login`, credentials, { withCredentials: true }).pipe(
      switchMap((res: LoginResponse) => {
        if (!res?.accessToken) {
          throw new Error('No access token in login response');
        }
        this.setSession(res.accessToken);
        return this.loadMe();
      }),
      map(() => void 0),
      catchError((err: unknown) => {
        this.setSession(null);
        return throwError(() => err);
      })
    );
  }

  logout(): void {
    this.http.post(`${this.authUrl}/logout`, {}, { withCredentials: true }).pipe(
      catchError(() => of(null)),
      finalize(() => {
        this.setSession(null);
        void this.router.navigate(['/login']);
      })
    ).subscribe();
  }

  refresh(): Observable<boolean> {
    return this.http.post<RefreshResponse>(`${this.authUrl}/refresh`, null, { withCredentials: true }).pipe(
      map((res: RefreshResponse) => {
        if (res?.accessToken) {
          this.setSession(res.accessToken);
          return true;
        }
        // Guard against races: if a valid login already set a token while this
        // refresh call was in flight, do not clear the new session.
        if (!this.accessToken) {
          this.setSession(null);
        }
        return false;
      }),
      catchError(() => {
        // Guard against races with a concurrent successful login.
        if (!this.accessToken) {
          this.setSession(null);
        }
        return of(false);
      })
    );
  }

  loadMe(): Observable<UserInfo | null> {
    return this.http.get<any>(`${this.authUrl}/me`, { withCredentials: true }).pipe(
      map((res: any) => {
        if (res?.username) {
          const roles = Array.isArray(res.roles) ? res.roles.map((r: string) => r.replace(/^ROLE_/, '')) : [];
          const user = { username: res.username, roles };
          this.userSubject.next(user);
          this.currentUser.set(user);
          return user;
        }
        this.userSubject.next(null);
        return null;
      }),
      catchError(() => {
        this.setSession(null);
        return of(null);
      })
    );
  }

  register(username: string, email: string | null, password: string): Observable<any> {
    return this.http.post(`${this.authUrl}/register`, { username, email, password });
  }

  verify(token: string): Observable<any> {
    return this.http.post(`${this.authUrl}/verify`, { token });
  }

  requestPasswordReset(identifier: string): Observable<any> {
    return this.http.post(`${this.authUrl}/request-reset`, { username: identifier });
  }

  resetPassword(token: string, password: string): Observable<any> {
    return this.http.post(`${this.authUrl}/reset-password`, { token, password });
  }

  /**
   * Fetches the auth config from the DTP backend and updates the ssoEnabled signal.
   * Called once on app startup via APP_INITIALIZER.
   * Requirements: 7.3, 6.5
   */
  loadAuthConfig(): Observable<void> {
    return this.http.get<AuthConfig>(`${this.authUrl}/config`).pipe(
      tap((config: AuthConfig) => this.ssoEnabled.set(!!config?.ssoEnabled)),
      map(() => void 0),
      catchError(() => {
        // If config fetch fails, leave ssoEnabled as false (safe default).
        return of(void 0);
      })
    );
  }

  /**
   * Stores the SSO-issued token and loads the current user.
   * Called by SsoCallbackComponent after the DTP backend redirects back with a JWT.
   * Requirements: 2.2, 5.4
   */
  handleSsoCallback(token: string): Observable<void> {
    this.setSession(token);
    return this.loadMe().pipe(map(() => void 0));
  }

  /**
   * Initiates a silent SSO check via the DTP backend.
   * Only called when ssoEnabled is true and no local session exists.
   * Navigates to /login if the redirect does not complete within 5 seconds.
   * Requirements: 6.1, 6.4
   */
  trySilentSso(returnUrl: string): void {
    const timeoutId = setTimeout(() => {
      void this.router.navigate(['/login']);
    }, 5000);

    // Store the timeout ID so SsoCallbackComponent can clear it on success.
    // We expose it via a simple property so the callback component can cancel it.
    this._silentSsoTimeoutId = timeoutId;

    window.location.href =
      `${this.authUrl}/sso/silent?returnUrl=${encodeURIComponent(returnUrl)}`;
  }

  /** @internal — used by SsoCallbackComponent to cancel the silent SSO timeout on success. */
  _silentSsoTimeoutId: ReturnType<typeof setTimeout> | null = null;

  getToken(): string | null {
    return this.accessToken || localStorage.getItem('auth_token') || sessionStorage.getItem('accessToken');
  }

  getAuthHeaders(): HttpHeaders | null {
    const token = this.getToken();
    return token ? new HttpHeaders({ Authorization: `Bearer ${token}` }) : null;
  }

  isAuthenticated(): boolean {
    return !!(this.userSubject.value || this.getToken());
  }

  /**
   * Clears the session state (token, storage, user) without navigating.
   * Used by SessionExpiredModalComponent before redirecting to /login.
   */
  clearSession(): void {
    this.cancelScheduledRefresh();
    this.accessToken = null;
    this.token$.next(null);
    sessionStorage.removeItem('accessToken');
    localStorage.removeItem('auth_token');
    this.userSubject.next(null);
    this.currentUser.set(null);
    this.sessionExpiryService.cancelWarning();
  }

  private setSession(token: string | null): void {
    this.cancelScheduledRefresh();
    this.accessToken = token;
    this.token$.next(token);
    if (!token) {
      sessionStorage.removeItem('accessToken');
      localStorage.removeItem('auth_token');
      this.userSubject.next(null);
      this.currentUser.set(null);
      this.sessionExpiryService.cancelWarning();
      return;
    }
    sessionStorage.setItem('accessToken', token);
    localStorage.setItem('auth_token', token);
    this.sessionExpiryService.scheduleWarning(token);
    this.scheduleRefreshForToken(token);
  }

  private scheduleRefreshForToken(token: string) {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      const exp: number = payload?.exp;
      if (!exp) return;
      const now = Math.floor(Date.now() / 1000);
      const refreshAt = Math.max(exp - 30, now + 1);
      const millis = (refreshAt - now) * 1000;
      this.refreshTimerSub = timer(millis).subscribe(() => this.refresh().subscribe());
    } catch { /* ignore parse errors */ }
  }

  private cancelScheduledRefresh() {
    this.refreshTimerSub?.unsubscribe();
    this.refreshTimerSub = null;
  }
}
