import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from './auth.service';
import { GlassInputComponent } from '../shared/components/glass-input.component';
import { environment } from '../../environments/environment';

@Component({
  standalone: true,
  selector: 'app-login',
  imports: [CommonModule, ReactiveFormsModule, RouterModule, MatIconModule, GlassInputComponent],
  template: `
    <div class="login-viewport">
      <div class="login-box glass-panel">
        <div class="login-header">
          <div class="logo-area">
            <mat-icon class="logo-icon">inventory_2</mat-icon>
            <div class="logo-text">
              <span class="accent">xFCS</span> Reloader
              <span class="v-tag">1.0</span>
            </div>
          </div>
          <p class="welcome-text">Archived File Reload Orchestration</p>
          <p class="subtitle">Sign in with your Resender account to access xFCS reloading operations.</p>
        </div>

        <!-- Requirement 1.4, 7.4: SSO error banner shown when reason=sso-error is in query params -->
        <div class="auth-error sso-error-banner" *ngIf="ssoError()">
          <mat-icon class="sso-error-icon">warning_amber</mat-icon>
          SSO sign-in failed. Please try again or use local login.
        </div>

        <!-- Requirement 1.1, 7.3: SSO button shown only when ssoEnabled is true -->
        <div class="sso-section" *ngIf="auth.ssoEnabled()">
          <button
            class="sso-btn"
            type="button"
            [disabled]="loading()"
            [class.is-loading]="loading()"
            (click)="onSsoLogin()"
          >
            <mat-icon *ngIf="!loading()">corporate_fare</mat-icon>
            <span *ngIf="!loading()">Sign in with onsemi SSO</span>
            <span *ngIf="loading()">Redirecting…</span>
          </button>
          <div class="sso-divider"><span>or sign in with credentials</span></div>
        </div>

        <form [formGroup]="loginForm" (ngSubmit)="onLogin()" class="login-form">
          <app-glass-input
            formControlName="username"
            label="Username"
            placeholder="Enter your username"
            prefixIcon="person_outline"
            autocomplete="username"
            [error]="getControlError('username')"
          ></app-glass-input>

          <app-glass-input
            formControlName="password"
            label="Password"
            type="password"
            placeholder="Enter your password"
            prefixIcon="lock_outline"
            autocomplete="current-password"
            [error]="getControlError('password')"
          ></app-glass-input>

          <div class="form-options">
            <a routerLink="/request-reset" class="accent-link small">Forgot Password?</a>
          </div>

          <div class="auth-error" *ngIf="error()">{{ error() }}</div>
          <div class="auth-success" *ngIf="success()">{{ success() }}</div>

          <button class="submit-btn" type="submit" [disabled]="loginForm.invalid || loading()" [class.is-loading]="loading()">
            <span *ngIf="!loading()">Authenticate</span>
            <span *ngIf="loading()">Signing in...</span>
            <mat-icon *ngIf="!loading()">login</mat-icon>
          </button>
        </form>

        <div class="login-footer">
          <div class="footer-links">
            <span>&copy; 2026 Exensio Data Integration</span>
            <div class="register-link">
              New user? <a routerLink="/register" class="accent-link">Create Account</a>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .login-viewport {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      background: linear-gradient(135deg, var(--bg-gradient-start, #0f172a) 0%, var(--bg-gradient-end, #1e1b4b) 100%);
    }
    .login-box {
      width: 100%;
      max-width: 480px;
      padding: 3.5rem;
      display: flex;
      flex-direction: column;
      gap: 2rem;
      box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5);
    }
    .login-header { text-align: center; display: flex; flex-direction: column; gap: 0.5rem; }
    .logo-area { display: flex; flex-direction: column; align-items: center; gap: 0.2rem; }
    .logo-icon {
      font-size: 3.5rem; width: 3.5rem; height: 3.5rem;
      color: var(--accent-color); margin-bottom: 0.5rem;
      font-family: 'Material Icons' !important;
      font-weight: normal;
      font-style: normal;
      line-height: 1;
      letter-spacing: normal;
      text-transform: none;
      display: inline-block;
      white-space: nowrap;
      word-wrap: normal;
      direction: ltr;
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
      -moz-osx-font-smoothing: grayscale;
      font-feature-settings: 'liga';
    }
    .logo-text {
      font-size: 1.8rem; font-weight: 800; letter-spacing: -0.05em; color: var(--text-main);
      .accent { color: var(--accent-color); }
      .v-tag {
        font-size: 0.8rem; vertical-align: super;
        background: rgba(129,140,248,0.15); padding: 2px 6px; border-radius: 4px; margin-left: 4px;
      }
    }
    .welcome-text { color: var(--text-main); font-size: 1.1rem; font-weight: 600; margin-top: 0.5rem; }
    .subtitle { color: var(--text-muted); font-size: 0.9rem; }
    .login-form { display: flex; flex-direction: column; gap: 1.5rem; }
    .form-options { display: flex; justify-content: flex-end; margin-top: -0.5rem; }
    .accent-link {
      color: var(--accent-color); text-decoration: none; font-weight: 600;
      &:hover { text-decoration: underline; }
      &.small { font-size: 0.85rem; opacity: 0.8; }
    }
    .auth-error, .auth-success {
      padding: 0.75rem; border-radius: 10px; font-size: 0.85rem;
      text-align: center; border: 1px solid transparent;
      animation: slideDown 0.3s ease-out;
    }
    .auth-error { background: rgba(239,68,68,0.1); color: #f87171; border-color: rgba(239,68,68,0.2); }
    .auth-success { background: rgba(16,185,129,0.1); color: #34d399; border-color: rgba(16,185,129,0.2); }
    @keyframes slideDown {
      from { opacity: 0; transform: translateY(-10px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .submit-btn {
      height: 56px; width: 100%; background: var(--accent-color); color: white;
      border: none; font-size: 1.1rem; font-weight: 600; border-radius: 14px;
      box-shadow: 0 8px 20px rgba(129,140,248,0.3); cursor: pointer;
      display: flex; align-items: center; justify-content: center; gap: 0.5rem;
      transition: all 0.3s ease;
      mat-icon { font-family: 'Material Icons' !important; }
      &:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 10px 25px rgba(129,140,248,0.4); }
      &:active:not(:disabled) { transform: translateY(0); }
      &:disabled { opacity: 0.6; cursor: not-allowed; }
    }
    .login-footer { text-align: center; font-size: 0.85rem; color: var(--text-muted); margin-top: 0.5rem; }
    .footer-links { display: flex; flex-direction: column; gap: 1rem; }
    .register-link { padding-top: 1rem; border-top: 1px solid rgba(255,255,255,0.05); }
    /* SSO section */
    .sso-error-banner {
      display: flex; align-items: center; gap: 0.5rem;
      padding: 0.75rem 1rem; border-radius: 10px; font-size: 0.875rem;
      background: rgba(239,68,68,0.1); color: #f87171; border: 1px solid rgba(239,68,68,0.2);
      animation: slideDown 0.3s ease-out;
    }
    .sso-error-icon { font-size: 1.1rem; width: 1.1rem; height: 1.1rem; flex-shrink: 0; }
    .sso-section { display: flex; flex-direction: column; gap: 1rem; }
    .sso-btn {
      height: 52px; width: 100%;
      background: rgba(255,255,255,0.05);
      color: var(--text-main);
      border: 1px solid rgba(255,255,255,0.12);
      font-size: 1rem; font-weight: 600; border-radius: 14px;
      cursor: pointer;
      display: flex; align-items: center; justify-content: center; gap: 0.5rem;
      transition: all 0.3s ease;
      mat-icon { font-family: 'Material Icons' !important; font-size: 1.2rem; width: 1.2rem; height: 1.2rem; }
      &:hover:not(:disabled) {
        background: rgba(255,255,255,0.1);
        border-color: var(--accent-color);
        color: var(--accent-color);
      }
      &:active:not(:disabled) { transform: translateY(0); }
      &:disabled { opacity: 0.6; cursor: not-allowed; }
    }
    .sso-divider {
      display: flex; align-items: center; gap: 1rem;
      color: var(--text-muted); font-size: 0.8rem;
      &::before, &::after {
        content: ''; flex: 1; height: 1px; background: rgba(255,255,255,0.08);
      }
    }
  `]
})
export class LoginComponent implements OnInit {
  private fb = inject(FormBuilder);
  readonly auth = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  loading = signal(false);
  error = signal('');
  success = signal('');
  /** Requirement 1.4, 7.4: true when reason=sso-error is present in query params */
  ssoError = signal(false);

  loginForm = this.fb.group({
    username: ['', [Validators.required, Validators.minLength(3)]],
    password: ['', [Validators.required, Validators.minLength(8)]]
  });

  ngOnInit(): void {
    // Requirement 1.4, 7.4: show SSO error banner if redirected back with reason=sso-error
    const reason = this.route.snapshot.queryParamMap.get('reason');
    if (reason === 'sso-error') {
      this.ssoError.set(true);
    }
  }

  /**
   * Requirement 1.2, 1.3: redirect to SSO initiation URL with encoded returnUrl.
   * Sets loading=true to prevent duplicate clicks (Requirement 1.4).
   */
  onSsoLogin(): void {
    if (this.loading()) return;
    this.loading.set(true);
    const returnUrl = encodeURIComponent(this.getSafeReturnUrl());
    window.location.href = `${environment.authUrl}/sso/initiate?returnUrl=${returnUrl}`;
  }

  onLogin() {
    if (this.loginForm.invalid || this.loading()) return;
    this.loading.set(true);
    this.error.set('');
    this.success.set('');

    this.auth.login(this.loginForm.getRawValue() as { username: string; password: string }).subscribe({
      next: async () => {
        this.success.set('Authenticated successfully. Redirecting...');
        const safeUrl = this.getSafeReturnUrl();
        const navigated = await this.router.navigateByUrl(safeUrl);

        if (!navigated && safeUrl !== '/dashboard') {
          await this.router.navigateByUrl('/dashboard');
        }

        this.loading.set(false);
      },
      error: (err: any) => {
        const message = err?.error?.error || err?.message || 'Invalid credentials or connection error.';
        this.error.set(message);
        this.loading.set(false);
        setTimeout(() => this.error.set(''), 5000);
      }
    });
  }

  private getSafeReturnUrl(): string {
    const raw = this.route.snapshot.queryParamMap.get('returnUrl');
    if (!raw) return '/dashboard';

    const decoded = this.decodeRepeatedly(raw);
    if (!decoded.startsWith('/') || decoded.includes('://') || decoded.startsWith('/login')) {
      return '/dashboard';
    }

    return decoded;
  }

  private decodeRepeatedly(value: string): string {
    let current = value;
    for (let i = 0; i < 4; i++) {
      const next = this.safeDecode(current);
      if (next === current) break;
      current = next;
    }
    return current;
  }

  private safeDecode(value: string): string {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  getControlError(controlName: string): string | null {
    const control = this.loginForm.get(controlName);
    if (control?.touched && control?.invalid) {
      if (control.hasError('required')) return `${controlName.charAt(0).toUpperCase() + controlName.slice(1)} is required`;
      if (control.hasError('minlength')) {
        return `Minimum ${control.getError('minlength').requiredLength} characters required`;
      }
    }
    return null;
  }
}
