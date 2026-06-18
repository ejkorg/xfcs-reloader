import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from './auth.service';

/**
 * Landing component for the /sso-callback route.
 * The DTP backend redirects here after a successful SSO authentication,
 * passing the JWT as a `token` query param and an optional `returnUrl`.
 *
 * Requirements: 2.2, 8.6
 */
@Component({
  standalone: true,
  selector: 'app-sso-callback',
  template: `
    <div style="display:flex;align-items:center;justify-content:center;min-height:100vh;">
      <span style="color:var(--text-muted,#94a3b8);font-size:1rem;">Completing sign-in…</span>
    </div>
  `
})
export class SsoCallbackComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly authService = inject(AuthService);

  ngOnInit(): void {
    const token = this.route.snapshot.queryParamMap.get('token');
    const rawReturnUrl = this.route.snapshot.queryParamMap.get('returnUrl') ?? '/dashboard';

    // Requirement 2.2: if token is missing, redirect to login with error reason
    if (!token) {
      void this.router.navigate(['/login'], { queryParams: { reason: 'sso-error' } });
      return;
    }

    // Cancel any pending silent-SSO timeout so it doesn't race with this success path
    if (this.authService._silentSsoTimeoutId !== null) {
      clearTimeout(this.authService._silentSsoTimeoutId);
      this.authService._silentSsoTimeoutId = null;
    }

    // Requirement 8.6: sanitize returnUrl — only allow relative paths, no open redirects
    const safeReturnUrl = this.sanitizeReturnUrl(rawReturnUrl);

    this.authService.handleSsoCallback(token).subscribe({
      next: () => void this.router.navigateByUrl(safeReturnUrl),
      error: () => void this.router.navigate(['/login'], { queryParams: { reason: 'sso-error' } })
    });
  }

  /**
   * Accepts only relative paths (start with '/', no '://').
   * Falls back to '/dashboard' for anything else.
   * Requirement 8.6
   */
  sanitizeReturnUrl(url: string): string {
    if (url && url.startsWith('/') && !url.includes('://')) {
      return url;
    }
    return '/dashboard';
  }
}
