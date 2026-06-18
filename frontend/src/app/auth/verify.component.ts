import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AuthService } from './auth.service';

@Component({
  selector: 'app-verify',
  standalone: true,
  imports: [CommonModule, RouterModule, MatIconModule, MatProgressSpinnerModule, MatSnackBarModule],
  template: `
    <div class="auth-viewport">
      <div class="auth-box glass-panel">
        <div class="auth-header">
          <mat-icon class="logo-icon"
            [class.success]="status === 'success'"
            [class.error]="status === 'error'">
            {{ status === 'loading' ? 'hourglass_empty' : status === 'success' ? 'verified_user' : 'error_outline' }}
          </mat-icon>
          <h1>Account <span class="accent">Verification</span></h1>
          <p class="subtitle" *ngIf="status === 'loading'">Validating your credentials...</p>
          <p class="subtitle success-text" *ngIf="status === 'success'">Your account has been verified successfully!</p>
          <p class="subtitle error-text" *ngIf="status === 'error'">Verification failed. The link may be expired or invalid.</p>
        </div>

        <div class="verify-actions">
          <mat-spinner *ngIf="status === 'loading'" diameter="40" class="mx-auto"></mat-spinner>

          <a *ngIf="status === 'success'" routerLink="/login" class="submit-btn">
            Go to Login
          </a>

          <div *ngIf="status === 'error'" class="error-actions">
            <a routerLink="/register" class="submit-btn danger">Try Registering Again</a>
            <a routerLink="/login" class="accent-link block mt-4">Back to Login</a>
          </div>
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
      width: 100%; max-width: 400px; padding: 3rem;
      display: flex; flex-direction: column; gap: 2rem; text-align: center;
    }
    .auth-header { text-align: center; }
    .logo-icon { font-size: 4rem; width: 4rem; height: 4rem; color: var(--text-muted); margin-bottom: 1rem; }
    .logo-icon.success { color: #10b981; }
    .logo-icon.error { color: #f87171; }
    .auth-header h1 { font-size: 1.8rem; margin: 0; color: var(--text-main, white); }
    .accent { color: var(--accent-color); }
    .subtitle { color: var(--text-muted); font-size: 0.9rem; margin-top: 0.5rem; }
    .success-text { color: #10b981 !important; }
    .error-text { color: #f87171 !important; }
    .mx-auto { margin: 0 auto; }
    .submit-btn {
      display: flex; align-items: center; justify-content: center;
      height: 52px; width: 100%; background: var(--accent-color); color: white;
      border: none; font-size: 1rem; font-weight: 600; border-radius: 12px;
      text-decoration: none; cursor: pointer;
      box-shadow: 0 8px 20px rgba(129,140,248,0.3);
      transition: all 0.3s ease;
      &:hover { transform: translateY(-2px); box-shadow: 0 10px 25px rgba(129,140,248,0.4); }
      &.danger { background: rgba(239,68,68,0.15); color: #f87171; box-shadow: none; border: 1px solid rgba(239,68,68,0.3); }
    }
    .error-actions { display: flex; flex-direction: column; gap: 1rem; }
    .accent-link { color: var(--accent-color); text-decoration: none; font-weight: 600; }
    .accent-link:hover { text-decoration: underline; }
    .block { display: block; }
    .mt-4 { margin-top: 0.5rem; }
  `]
})
export class VerifyComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private auth = inject(AuthService);
  private snackBar = inject(MatSnackBar);

  status: 'loading' | 'success' | 'error' = 'loading';

  ngOnInit(): void {
    const token = this.route.snapshot.queryParamMap.get('token');
    if (!token) {
      this.status = 'error';
      return;
    }
    this.auth.verify(token).subscribe({
      next: () => {
        this.status = 'success';
        this.snackBar.open('Account verified!', 'Close', { duration: 3000 });
      },
      error: () => {
        this.status = 'error';
      }
    });
  }
}
