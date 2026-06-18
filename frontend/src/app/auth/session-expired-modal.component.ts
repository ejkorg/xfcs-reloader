import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';

@Component({
  selector: 'app-session-expired-modal',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="glass-panel session-expired-panel">
      <div class="modal-icon">🔒</div>
      <h2 class="modal-title">Session Expired</h2>

      <p class="modal-body">
        Your session has expired due to inactivity.<br>
        Please log in again to continue.
      </p>

      <div class="modal-actions">
        <button
          type="button"
          class="btn btn-primary"
          (click)="onLogInAgain()">
          Log In Again
        </button>
      </div>
    </div>
  `,
  styles: [`
    .session-expired-panel {
      min-width: 320px;
      max-width: 420px;
      padding: 2rem 2rem 1.5rem;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: .75rem;
      text-align: center;
    }
    .modal-icon {
      font-size: 2.5rem;
      line-height: 1;
    }
    .modal-title {
      margin: 0;
      font-size: 1.2rem;
      font-weight: 700;
      color: var(--text-main);
    }
    .modal-body {
      margin: 0;
      color: var(--text-secondary, var(--text-main));
      font-size: .95rem;
      line-height: 1.6;
    }
    .modal-actions {
      margin-top: .5rem;
      width: 100%;
      display: flex;
      justify-content: center;
    }
    .btn {
      height: 38px;
      padding: 0 1.8rem;
      border-radius: 10px;
      font-weight: 700;
      cursor: pointer;
      border: 1px solid transparent;
      font-size: .9rem;
      transition: opacity .15s;
    }
    .btn-primary {
      background: var(--accent-color, #f59e0b);
      color: #fff;
    }
    .btn-primary:hover { opacity: .88; }
    @media (max-width: 768px) {
      .session-expired-panel { min-width: unset; width: 90vw; padding: 1.5rem 1rem; }
      .btn { width: 100%; }
    }
  `],
})
export class SessionExpiredModalComponent {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  onLogInAgain(): void {
    const returnUrl = this.getSafeReturnUrlFromCurrentLocation();
    this.authService.clearSession();
    void this.router.navigate(['/login'], {
      queryParams: { returnUrl },
    });
  }

  private getSafeReturnUrlFromCurrentLocation(): string {
    const currentUrl = this.router.url || '/dashboard';

    // If already on /login, reuse the existing returnUrl (if present) to avoid
    // nested URLs like /login?returnUrl=/login?returnUrl=...
    if (currentUrl.startsWith('/login')) {
      const parsed = this.router.parseUrl(currentUrl);
      const nested = parsed.queryParams?.['returnUrl'];
      if (typeof nested === 'string' && nested.trim()) {
        return this.normalizeReturnUrl(nested);
      }
      return '/dashboard';
    }

    return this.normalizeReturnUrl(currentUrl);
  }

  private normalizeReturnUrl(raw: string): string {
    const decoded = this.safeDecode(raw);
    if (!decoded.startsWith('/') || decoded.includes('://') || decoded.startsWith('/login')) {
      return '/dashboard';
    }
    return decoded;
  }

  private safeDecode(value: string): string {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
}
