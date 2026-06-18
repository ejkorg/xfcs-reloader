import { Component, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AuthService } from './auth.service';
import { GlassInputComponent } from '../shared/components/glass-input.component';

@Component({
  selector: 'app-request-reset',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule, MatIconModule, MatSnackBarModule, GlassInputComponent],
  template: `
    <div class="auth-viewport">
      <div class="auth-box glass-panel">
        <div class="auth-header">
          <mat-icon class="logo-icon">lock_reset</mat-icon>
          <h1>Request <span class="accent">Reset</span></h1>
          <p class="subtitle">Enter your email to receive recovery instructions.</p>
        </div>

        <form [formGroup]="resetForm" (ngSubmit)="onSubmit()" class="auth-form" *ngIf="!emailSent()">
          <app-glass-input
            formControlName="email"
            label="Email Address"
            placeholder="your@email.com"
            prefixIcon="mail_outline"
            [error]="getControlError('email')"
          ></app-glass-input>

          <div class="auth-error" *ngIf="error()">{{ error() }}</div>

          <button class="submit-btn" type="submit" [disabled]="resetForm.invalid || loading()">
            <span *ngIf="!loading()">Send Recovery Link</span>
            <span *ngIf="loading()">Processing...</span>
            <mat-icon *ngIf="!loading()">send</mat-icon>
          </button>
        </form>

        <div class="success-message glass-panel" *ngIf="emailSent()">
          <mat-icon class="success-icon">mark_email_read</mat-icon>
          <h3>Email Sent</h3>
          <p>Recovery instructions have been sent to your email address.</p>
          <button class="submit-btn mt-4" routerLink="/login">Return to Login</button>
        </div>

        <div class="auth-footer" *ngIf="!emailSent()">
          <span>Remember your password?</span>
          <a routerLink="/login" class="accent-link">Sign In</a>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .auth-viewport {
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh;
      background: linear-gradient(135deg, var(--bg-gradient-start, #0f172a) 0%, var(--bg-gradient-end, #1e1b4b) 100%);
    }
    .auth-box { width: 100%; max-width: 440px; padding: 3.5rem; display: flex; flex-direction: column; gap: 2rem; }
    .auth-header { text-align: center; }
    .logo-icon { font-size: 3.5rem; width: 3.5rem; height: 3.5rem; color: var(--accent-color); margin-bottom: 1rem; }
    .auth-header h1 { font-size: 1.8rem; margin: 0; color: var(--text-main, white); }
    .accent { color: var(--accent-color); }
    .subtitle { color: var(--text-muted); font-size: 0.9rem; margin-top: 0.5rem; }
    .auth-form { display: flex; flex-direction: column; gap: 1.5rem; }
    .auth-error {
      padding: 0.75rem; border-radius: 10px; font-size: 0.85rem; text-align: center;
      background: rgba(239,68,68,0.1); color: #f87171; border: 1px solid rgba(239,68,68,0.2);
    }
    .submit-btn {
      height: 56px; width: 100%; background: var(--accent-color); color: white;
      border: none; font-size: 1.1rem; font-weight: 600; border-radius: 14px;
      box-shadow: 0 8px 20px rgba(129,140,248,0.3); cursor: pointer;
      display: flex; align-items: center; justify-content: center; gap: 0.5rem;
      transition: all 0.3s ease;
      &:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 10px 25px rgba(129,140,248,0.4); }
      &:disabled { opacity: 0.6; cursor: not-allowed; }
    }
    .success-message {
      text-align: center; padding: 2rem;
      background: rgba(16,185,129,0.05); border: 1px solid rgba(16,185,129,0.1);
    }
    .success-icon { font-size: 4rem; width: 4rem; height: 4rem; color: #10b981; margin-bottom: 1rem; }
    .success-message h3 { color: var(--text-main, white); margin-bottom: 0.5rem; }
    .success-message p { color: var(--text-muted); font-size: 0.9rem; margin-bottom: 1.5rem; }
    .auth-footer {
      text-align: center; font-size: 0.9rem; color: var(--text-muted);
      padding-top: 1rem; border-top: 1px solid rgba(255,255,255,0.05);
    }
    .accent-link { color: var(--accent-color); text-decoration: none; margin-left: 5px; font-weight: 600; }
    .accent-link:hover { text-decoration: underline; }
    .mt-4 { margin-top: 1rem; }
  `]
})
export class RequestResetComponent {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private snackBar = inject(MatSnackBar);

  loading = signal(false);
  emailSent = signal(false);
  error = signal('');

  resetForm = this.fb.group({
    email: ['', [Validators.required, Validators.email]]
  });

  getControlError(controlName: string): string | null {
    const control = this.resetForm.get(controlName);
    if (control?.touched && control?.invalid) {
      if (control.hasError('required')) return 'Email is required';
      if (control.hasError('email')) return 'Invalid email address';
    }
    return null;
  }

  onSubmit() {
    if (this.resetForm.invalid || this.loading()) return;
    this.loading.set(true);
    this.error.set('');

    this.auth.requestPasswordReset(this.resetForm.value.email!).subscribe({
      next: () => {
        this.loading.set(false);
        this.emailSent.set(true);
        this.snackBar.open('Recovery email sent!', 'Close', { duration: 3000 });
      },
      error: (err: any) => {
        this.loading.set(false);
        this.error.set(err.error?.message || 'Request failed. Please check your connection.');
      }
    });
  }
}
