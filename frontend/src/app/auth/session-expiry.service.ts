import { Injectable, inject } from '@angular/core';
import { Observable, Subject, Subscription, timer } from 'rxjs';
import { GlassDialogRef, GlassDialogService } from '../shared/services/glass-dialog.service';
import { SessionWarningModalComponent } from './session-warning-modal.component';
import { SessionExpiredModalComponent } from './session-expired-modal.component';

/** Seconds before token expiry at which the warning modal is shown. */
const WARNING_THRESHOLD_SECONDS = 120;

@Injectable({ providedIn: 'root' })
export class SessionExpiryService {
  private readonly dialogService = inject(GlassDialogService);

  // ── Subjects ──────────────────────────────────────────────────────────────

  private readonly _warning$ = new Subject<number>();
  private readonly _expired$ = new Subject<void>();

  /** Emits the number of seconds remaining when the warning threshold is crossed. */
  readonly warning$: Observable<number> = this._warning$.asObservable();

  /** Emits when the session is confirmed expired. */
  readonly expired$: Observable<void> = this._expired$.asObservable();

  // ── Internal state ────────────────────────────────────────────────────────

  private warningTimerSub: Subscription | null = null;
  private modalOpen = false;
  private activeDialogRef: GlassDialogRef | null = null;

  constructor() {
    // Wire warning$ → open SessionWarningModalComponent
    this.warning$.subscribe((secondsRemaining: number) => {
      if (this.modalOpen) return;
      this.modalOpen = true;
      const ref = this.dialogService.open(SessionWarningModalComponent, {
        data: { secondsRemaining },
        disableClose: true,
      });
      this.activeDialogRef = ref;
      ref.afterClosed$.subscribe(() => {
        this.modalOpen = false;
        this.activeDialogRef = null;
      });
    });

    // Wire expired$ → close warning modal (if open), open SessionExpiredModalComponent
    this.expired$.subscribe(() => {
      if (this.activeDialogRef) {
        // Close the warning modal without triggering the afterClosed$ reset yet —
        // we immediately open the expired modal, so we manage the flag manually.
        const warningRef = this.activeDialogRef;
        this.activeDialogRef = null;
        warningRef.close();
      }

      if (this.modalOpen && !this.activeDialogRef) {
        // Warning modal was just closed above; reset flag so expired modal can open.
        this.modalOpen = false;
      }

      if (this.modalOpen) {
        // Expired modal is already open — ignore duplicate event (Requirement 2.7).
        return;
      }

      this.modalOpen = true;
      const ref = this.dialogService.open(SessionExpiredModalComponent, {
        disableClose: true,
      });
      this.activeDialogRef = ref;
      ref.afterClosed$.subscribe(() => {
        this.modalOpen = false;
        this.activeDialogRef = null;
      });
    });
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Parse the JWT expiry and schedule a warning timer at `exp - 120s`.
   * Called by AuthService.setSession() when a new token is stored.
   */
  scheduleWarning(token: string): void {
    this.cancelWarning();
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      const exp: number = payload?.exp;
      if (!exp) return;

      const now = Math.floor(Date.now() / 1000);
      const warnAt = exp - WARNING_THRESHOLD_SECONDS;
      const delayMs = Math.max((warnAt - now) * 1000, 0);

      this.warningTimerSub = timer(delayMs).subscribe(() => {
        const remaining = Math.max(exp - Math.floor(Date.now() / 1000), 0);
        this._warning$.next(remaining);
      });
    } catch {
      // Malformed token — no-op (Requirement: error handling)
    }
  }

  /**
   * Cancel any pending warning timer.
   * Called by AuthService.setSession(null).
   */
  cancelWarning(): void {
    this.warningTimerSub?.unsubscribe();
    this.warningTimerSub = null;
  }

  /**
   * Emit a session-expired event.
   * Called by AuthInterceptor on 401 responses.
   */
  notifyExpired(): void {
    this._expired$.next();
  }
}
