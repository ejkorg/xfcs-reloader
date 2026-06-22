import {
  Component,
  DestroyRef,
  inject,
  OnInit,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import {
  BehaviorSubject,
  catchError,
  EMPTY,
  exhaustMap,
  forkJoin,
  interval,
  of,
  startWith,
  switchMap,
  timer,
} from 'rxjs';
import { GlassButtonComponent } from '../shared/components/glass-button.component';
import { GlassIconComponent } from '../shared/components/glass-icon.component';
import { XfcsStatsComponent } from './xfcs-stats.component';
import { XfcsApiService } from '../api/xfcs-api.service';
import { DashboardData, ReloadStatus } from '../api/xfcs-models';
import { ToastService } from '../shared/services/toast.service';

@Component({
  selector: 'app-xfcs-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    GlassButtonComponent,
    GlassIconComponent,
    XfcsStatsComponent,
  ],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class XfcsDashboardComponent implements OnInit {
  /** Dashboard snapshot from the API */
  data = signal<DashboardData | undefined>(undefined);

  /** Active (non-terminal) sessions */
  activeSessions = signal<ReloadStatus[]>([]);

  /** True during the initial load */
  loading = signal(false);

  /** True during a background refresh cycle */
  refreshing = signal(false);

  /** API connectivity status */
  connected = signal(true);

  /** Timestamp of the last successful data fetch */
  lastUpdated = signal<Date | undefined>(undefined);

  // ── Per-panel loading signals ─────────────────────────────────────

  /** Whether the sessions panel data is being loaded */
  loadingSessions = signal(true);

  /** Whether the lots panel data is being loaded */
  loadingLots = signal(true);

  // ── Per-panel error signals ───────────────────────────────────────

  /** Error message for the sessions panel */
  sessionsError = signal<string | null>(null);

  /** Error message for the lots panel */
  lotsError = signal<string | null>(null);

  /** Error message for the system status panel */
  statusError = signal<string | null>(null);

  // ── Derived ───────────────────────────────────────────────────────

  /** Hard-coded fallback; ideally this would come from a config endpoint. */
  archiveMountPath = signal('/export/home/dpower/archives');

  // ── Retry triggers (increment to fire a retry) ─────────────────---

  private readonly dashboardRetry$ = new BehaviorSubject<number>(0);
  private readonly sessionsRetry$ = new BehaviorSubject<number>(0);

  private readonly destroyRef = inject(DestroyRef);

  constructor(
    private readonly api: XfcsApiService,
    private readonly toast: ToastService,
  ) {}

  ngOnInit(): void {
    this.loadDashboard();
    this.loadSessions();

    // Background polling — uses exhaustMap to skip if a cycle is in-flight
    interval(30_000)
      .pipe(
        startWith(0),
        exhaustMap(() => {
          // Only poll if both streams have succeeded at least once
          return forkJoin({
            dashboard: this.api.getDashboard(),
            sessions: this.api.getSessions(),
          }).pipe(
            catchError(() => EMPTY), // silent background failure
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(({ dashboard, sessions }) => {
        this.data.set(dashboard);
        this.activeSessions.set(this.filterActive(sessions));
        this.connected.set(true);
        this.lastUpdated.set(new Date());
        this.refreshing.set(false);
        this.loadingSessions.set(false);
        this.loadingLots.set(false);
      });
  }

  // ── Data loading (called on init + retry) ────────────────────────

  loadDashboard(): void {
    this.loadingLots.set(true);
    this.lotsError.set(null);

    this.dashboardRetry$
      .pipe(
        exhaustMap(() =>
          this.api.getDashboard().pipe(
            catchError((err) => {
              this.lotsError.set('Failed to load dashboard metrics.');
              this.statusError.set('Dashboard API is unreachable.');
              this.connected.set(false);
              this.loadingLots.set(false);
              this.loading.set(false);
              this.refreshing.set(false);
              return EMPTY;
            }),
          ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((dashboard) => {
        this.data.set(dashboard);
        this.lotsError.set(null);
        this.statusError.set(null);
        this.connected.set(true);
        this.loadingLots.set(false);
        this.loading.set(false);
        this.refreshing.set(false);
        this.lastUpdated.set(new Date());
      });
  }

  loadSessions(): void {
    this.loadingSessions.set(true);
    this.sessionsError.set(null);

    this.sessionsRetry$
      .pipe(
        exhaustMap(() =>
          this.api.getSessions().pipe(
            catchError((err) => {
              this.sessionsError.set('Failed to load active sessions.');
              this.loadingSessions.set(false);
              return EMPTY;
            }),
          ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((sessions) => {
        this.activeSessions.set(this.filterActive(sessions));
        this.sessionsError.set(null);
        this.loadingSessions.set(false);
      });
  }

  /** Retry fetching the dashboard payload */
  retryDashboard(): void {
    this.dashboardRetry$.next(this.dashboardRetry$.value + 1);
  }

  /** Retry fetching sessions */
  retrySessions(): void {
    this.sessionsRetry$.next(this.sessionsRetry$.value + 1);
  }

  // ── Helpers ──────────────────────────────────────────────────────

  /** Return only non-terminal sessions */
  private filterActive(sessions: ReloadStatus[]): ReloadStatus[] {
    const terminal = new Set([
      'completed',
      'failed',
      'partially_failed',
      'cancelled',
    ]);
    return sessions.filter((s) => !terminal.has(s.status?.toLowerCase()));
  }

  /** Compute progress as a percentage (0–100) */
  sessionProgress(s: ReloadStatus): number {
    if (!s.totalFiles) return 0;
    const done = (s.completedFiles ?? 0) + (s.failedFiles ?? 0);
    return Math.min(100, Math.round((done / s.totalFiles) * 100));
  }

  /** Map a status string to its CSS class */
  statusClass(status: string): string {
    const map: Record<string, string> = {
      processing: 'status-processing',
      created: 'status-created',
      queued: 'status-queued',
      completed: 'status-completed',
      failed: 'status-failed',
      partially_failed: 'status-partially_failed',
      cancelled: 'status-cancelled',
    };
    return map[status?.toLowerCase()] ?? 'status-created';
  }

  /** trackBy for session list */
  trackBySessionId(_: number, s: ReloadStatus): string {
    return s.sessionId;
  }

  /** trackBy for lot list */
  trackByLot(_: number, lot: string): string {
    return lot;
  }
}
