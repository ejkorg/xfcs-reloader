import { Component, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AuthService } from './auth.service';
import { GlassInputComponent } from '../shared/components/glass-input.component';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule, MatIconModule, MatSnackBarModule, GlassInputComponent],
  template: `
    <div class="auth-viewport">
      <div class="auth-box glass-panel">
        <div class="auth-header">
          <mat-icon class="logo-icon">person_add</mat-icon>
          <h1>Create <span class="accent">Account</span></h1>
          <p class="subtitle">Register to access XFCS Reloader operations.</p>
        </div>

        <form [formGroup]="registerForm" (ngSubmit)="onSubmit()" class="auth-form">
          <app-glass-input
            formControlName="username"
            label="Username"
            placeholder="Choose a username"
            prefixIcon="person_outline"
            [error]="getControlError('username')"
          ></app-glass-input>

          <app-glass-input
            formControlName="email"
            label="Email"
            placeholder="your@email.com (optional)"
            prefixIcon="mail_outline"
            [error]="getControlError('email')"
          ></app-glass-input>

          <app-glass-input
            formControlName="password"
            label="Password"
            [type]="hidePassword() ? 'password' : 'text'"
            placeholder="Min 8 characters"
            prefixIcon="lock_outline"
            [suffixIcon]="hidePassword() ? 'visibility_off' : 'visibility'"
            (suffixAction)="hidePassword.set(!hidePassword())"
            [error]="getControlError('password')"
          ></app-glass-input>

          <div class="auth-error" *ngIf="error()">{{ error() }}</div>

          <button class="submit-btn" type="submit" [disabled]="registerForm.invalid || loading()">
            <span *ngIf="!loading()">Create Account</span>
            <span *ngIf="loading()">Processing...</span>
            <mat-icon *ngIf="!loading()">chevron_right</mat-icon>
          </button>
        </form>

        <div class="auth-footer">
          <span>Already have an account?</span>
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
    .auth-box {
      width: 100%; max-width: 440px; padding: 3.5rem;
      display: flex; flex-direction: column; gap: 2rem;
    }
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
    .auth-footer {
      text-align: center; font-size: 0.9rem; color: var(--text-muted);
      padding-top: 1rem; border-top: 1px solid rgba(255,255,255,0.05);
    }
    .accent-link { color: var(--accent-color); text-decoration: none; margin-left: 5px; font-weight: 600; }
    .accent-link:hover { text-decoration: underline; }
  `]
})
export class RegisterComponent {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private router = inject(Router);
  private snackBar = inject(MatSnackBar);

  loading = signal(false);
  hidePassword = signal(true);
  error = signal('');

  registerForm = this.fb.group({
    username: ['', [Validators.required, Validators.minLength(3)]],
    email: ['', [Validators.email]],
    password: ['', [Validators.required, Validators.minLength(8)]]
  });

  getControlError(controlName: string): string | null {
    const control = this.registerForm.get(controlName);
    if (control?.touched && control?.invalid) {
      if (control.hasError('required')) return `${controlName.charAt(0).toUpperCase() + controlName.slice(1)} is required`;
      if (control.hasError('minlength')) return `Minimum ${control.getError('minlength').requiredLength} characters required`;
      if (control.hasError('email')) return 'Invalid email address';
    }
    return null;
  }

  onSubmit() {
    if (this.registerForm.invalid || this.loading()) return;
    this.loading.set(true);
    this.error.set('');

    const { username, email, password } = this.registerForm.getRawValue();
    this.auth.register(username!, email || null, password!).subscribe({
      next: (res: any) => {
        this.loading.set(false);
        this.snackBar.open('Registration successful!', 'Close', { duration: 3000 });
        this.router.navigate(['/verify'], { queryParams: { token: res?.verificationToken } });
      },
      error: (err: any) => {
        this.loading.set(false);
        this.error.set(err.error?.message || 'Registration failed. User might already exist.');
      }
    });
  }
}
