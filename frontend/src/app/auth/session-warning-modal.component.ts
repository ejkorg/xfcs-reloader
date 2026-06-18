import {
  Component,
  OnInit,
  OnDestroy,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { GLASS_DIALOG_DATA } from '../shared/services/glass-dialog-data.token';
import { GlassDialogRef } from '../shared/services/glass-dialog.service';
import { AuthService } from './auth.service';
import { SessionExpiryService } from './session-expiry.service';
import { ToastService } from '../shared/services/toast.service';

export interface SessionWarningDialogData {
  secondsRemaining: number;
}

@Component({
  selector: 'app-session-warning-modal',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="glass-panel session-warning-panel">
      <div class="modal-icon">⚠</div>
      <h2 class="modal-title">Session Expiring Soon</h2>

      <p class="modal-body">Your session will expire in</p>
      <div class="countdown">{{ formatCountdown(secondsRemaining) }}</div>
      <p class="modal-hint">Stay active to keep working, or log out now.</p>

      <div class="modal-actions">
        <button
          type="button"
          class="btn btn-outline"
          (click)="onLogOut()"
          [disabled]="refreshing">
          Log Out
        </button>
        <button
          type="button"
          class="btn btn-primary"
          (click)="onStayLoggedIn()"
          [disabled]="refreshing">
          {{ refreshing ? 'Extending…' : 'Stay Logged In' }}
        </button>
      </div>
    </div>
  `,
  styles: [`
    .session-warning-panel {
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
      font-size: 2rem;
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
    }
    .countdown {
      font-size: 2.5rem;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      color: var(--accent-color, #f59e0b);
      letter-spacing: .05em;
    }
    .modal-hint {
      margin: 0;
      font-size: .85rem;
      color: var(--text-secondary, var(--text-main));
      opacity: .8;
    }
    .modal-actions {
      display: flex;
      gap: .75rem;
      margin-top: .5rem;
      width: 100%;
      justify-content: center;
    }
    .btn {
      height: 38px;
      padding: 0 1.2rem;
      border-radius: 10px;
      font-weight: 700;
      cursor: pointer;
      border: 1px solid transparent;
      font-size: .9rem;
      transition: opacity .15s;
    }
    .btn:disabled { opacity: .55; cursor: not-allowed; }
    .btn-outline {
      background: color-mix(in srgb, var(--card-bg) 86%, transparent);
      color: var(--text-main);
      border-color: var(--card-border);
    }
    .btn-primary {
      background: var(--accent-color, #f59e0b);
      color: #fff;
    }
    @media (max-width: 768px) {
      .session-warning-panel { min-width: unset; width: 90vw; padding: 1.5rem 1rem; }
      .modal-actions { flex-direction: column; }
      .btn { width: 100%; }
    }
  `],
})
export class SessionWarningModalComponent implements OnInit, OnDestroy {
  private readonly data = inject<SessionWarningDialogData>(GLASS_DIALOG_DATA as any);
  private readonly dialogRef = inject(GlassDialogRef);
  private readonly authService = inject(AuthService);
  private readonly sessionExpiryService = inject(SessionExpiryService);
  private readonly toastService = inject(ToastService);

  secondsRemaining: number = 0;
  refreshing = false;

  private intervalId: ReturnType<typeof setInterval> | null = null;
  private tokenSub: Subscription | null = null;

  ngOnInit(): void {
    this.secondsRemaining = this.data?.secondsRemaining ?? 120;

    // Decrement countdown every second
    this.intervalId = setInterval(() => {
      this.secondsRemaining = Math.max(this.secondsRemaining - 1, 0);
      if (this.secondsRemaining === 0) {
        this.clearInterval();
        this.dialogRef.close();
        this.sessionExpiryService.notifyExpired();
      }
    }, 1000);

    // Auto-close if a new token arrives (background refresh succeeded)
    this.tokenSub = this.authService.token$.subscribe((token: string | null) => {
      if (token) {
        this.dialogRef.close();
      }
    });
  }

  ngOnDestroy(): void {
    this.clearInterval();
    this.tokenSub?.unsubscribe();
  }

  /** Pure function — converts seconds to MM:SS string. */
  formatCountdown(s: number): string {
    const minutes = Math.floor(s / 60);
    const seconds = s % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  onStayLoggedIn(): void {
    this.refreshing = true;
    this.authService.refresh().subscribe({
      next: (ok: boolean) => {
        if (ok) {
          this.toastService.success('Session extended successfully.');
          this.dialogRef.close();
        } else {
          // Refresh failed — transition to expired modal
          this.dialogRef.close();
          this.sessionExpiryService.notifyExpired();
        }
        this.refreshing = false;
      },
      error: () => {
        this.refreshing = false;
        this.dialogRef.close();
        this.sessionExpiryService.notifyExpired();
      },
    });
  }

  onLogOut(): void {
    this.authService.logout();
  }

  private clearInterval(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}
