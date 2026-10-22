import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';

/**
 * Public landing page for the DTP backend's SSO redirect.
 *
 * The DTP backend redirects here after Azure AD authentication completes,
 * passing the JWT as a `token` query parameter. This component extracts the
 * token, stores it via AuthService, and redirects to the dashboard.
 */
@Component({
  selector: 'app-sso-callback',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="sso-callback-container">
      <p class="status-message">Completing SSO authentication…</p>
    </div>
  `,
  styles: [`
    .sso-callback-container {
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      padding: 24px;
    }

    .status-message {
      color: rgba(255, 255, 255, 0.85);
      font-size: 14px;
      margin: 0;
    }
  `]
})
export class SsoCallbackComponent implements OnInit {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  ngOnInit(): void {
    const url = new URL(window.location.href);
    const token = url.searchParams.get('token');
    const error = url.searchParams.get('error');

    if (error) {
      void this.router.navigate(['/login']);
      return;
    }

    if (!token) {
      void this.router.navigate(['/login']);
      return;
    }

    // Clear the silent SSO timeout set by app.config.ts.
    if (this.authService._silentSsoTimeoutId) {
      clearTimeout(this.authService._silentSsoTimeoutId);
      this.authService._silentSsoTimeoutId = null;
    }

    this.authService.handleSsoCallback(token).subscribe({
      next: () => void this.router.navigate(['/dashboard']),
      error: () => void this.router.navigate(['/login'])
    });
  }
}
