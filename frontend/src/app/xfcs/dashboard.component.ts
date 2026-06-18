import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { forkJoin, interval } from 'rxjs';
import { GlassButtonComponent } from '../shared/components/glass-button.component';
import { GlassIconComponent } from '../shared/components/glass-icon.component';
import { XfcsStatsComponent } from './xfcs-stats.component';
import { XfcsApiService } from '../api/xfcs-api.service';
import { DashboardData, ReloadStatus } from '../api/xfcs-models';
import { ToastService } from '../shared/services/toast.service';
 
@Component({
  selector: 'app-xfcs-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink, GlassButtonComponent, GlassIconComponent, XfcsStatsComponent],
  template: `
    <div class="dashboard-root">
      <header class="dashboard-header animated fadeIn">
        <div class="title-group">
          <h1>xFCS <span class="accent">Reloader Dashboard</span></h1>
          <p class="subtitle">System health and recent archival activity overview.</p>
          <p class="last-updated" *ngIf="lastUpdated()">
            Last updated: {{ lastUpdated() | date:'medium' }}
          </p>
        </div>
        <div class="header-actions">
          <app-glass-button routerLink="/reload/new" variant="primary">
            <app-glass-icon name="add" [size]="18" color="default"></app-glass-icon>
            New Reload Request
          </app-glass-button>
        </div>
      </header>
 
      <!-- KPI Section -->
      <section class="stats-section mb-6">
        <app-xfcs-stats [dashboard]="data()" [loading]="loading()"></app-xfcs-stats>
      </section>
 
      <div class="dashboard-grid">
        <!-- Left Column -->
        <div class="left-column">
          <!-- Active Sessions Panel -->
          <section class="glass-panel sessions-panel animated slideUp">
            <div class="panel-header">
              <app-glass-icon name="sync" color="primary"></app-glass-icon>
              <h3>Active <span class="accent">Sessions</span></h3>
            </div>
            <div class="session-list" *ngIf="activeSessions().length; else emptySessions">
              <div class="session-row" *ngFor="let s of activeSessions()">
                <span class="session-id">{{ s.sessionId.slice(0, 8) }}</span>
                <span class="env-badge">{{ s.environment ?? '—' }}</span>
                <span class="requester">{{ s.requester ?? '—' }}</span>
                <div class="progress-wrap">
                  <div class="progress-bar">
                    <div class="progress-fill" [style.width.%]="calcProgress(s)"></div>
                  </div>
                  <span class="progress-pct">{{ calcProgress(s) }}%</span>
                </div>
                <span class="status-badge" [class]="'status-' + s.status">{{ s.status }}</span>
              </div>
            </div>
            <ng-template #emptySessions>
              <div class="empty-state">No active sessions — system is idle.</div>
            </ng-template>
            <div class="panel-footer">
              <a routerLink="/history" class="footer-link">View All Sessions →</a>
            </div>
          </section>

          <!-- Recent Lots Feed -->
          <section class="glass-panel feed-panel animated slideUp" style="animation-delay: 0.05s">
            <div class="panel-header">
              <app-glass-icon name="history" color="primary"></app-glass-icon>
              <h3>Recent <span class="accent">Extracted Lots</span></h3>
            </div>
            <div class="lot-list" *ngIf="data()?.recentLots?.length; else emptyLots">
              <div class="lot-item" *ngFor="let lot of data()?.recentLots?.slice(0, 8); let i = index" [style.animation-delay]="i * 0.05 + 's'">
                <div class="lot-icon">
                  <app-glass-icon name="inventory_2" [size]="18" color="muted"></app-glass-icon>
                </div>
                <div class="lot-name">{{ lot }}</div>
                <div class="lot-badge">Extracted</div>
              </div>
            </div>
            <ng-template #emptyLots>
              <div class="empty-state">No recent lot activity.</div>
            </ng-template>
            <div class="panel-footer">
              <a routerLink="/history" class="footer-link">View Full History →</a>
            </div>
          </section>
        </div>

        <!-- Right Column -->
        <div class="right-column">
          <!-- Quick Actions Panel -->
          <section class="glass-panel actions-panel animated slideUp" style="animation-delay: 0.08s">
            <div class="panel-header">
              <app-glass-icon name="dashboard" color="primary"></app-glass-icon>
              <h3>Quick <span class="accent">Actions</span></h3>
            </div>
            <div class="actions-list">
              <div class="action-item">
                <app-glass-button routerLink="/reload/new" variant="primary" size="large">
                  <app-glass-icon name="add" [size]="18" color="default"></app-glass-icon>
                  New Reload
                </app-glass-button>
                <p class="action-desc">Start a new archival reload session for a lot.</p>
              </div>
              <div class="action-item">
                <app-glass-button routerLink="/history" variant="secondary" size="large">
                  <app-glass-icon name="history" [size]="18" color="default"></app-glass-icon>
                  View Sessions
                </app-glass-button>
                <p class="action-desc">Browse all past and current reload sessions.</p>
              </div>
              <div class="action-item">
                <app-glass-button routerLink="/monitor" variant="secondary" size="large">
                  <app-glass-icon name="sensors" [size]="18" color="default"></app-glass-icon>
                  File Monitor
                </app-glass-button>
                <p class="action-desc">Track pending file statuses across environments.</p>
              </div>
            </div>
          </section>

          <!-- System Status Panel -->
          <section class="glass-panel tips-panel animated slideUp" style="animation-delay: 0.1s">
            <div class="panel-header">
              <app-glass-icon name="monitor_heart" color="warning"></app-glass-icon>
              <h3>System <span class="accent">Status</span></h3>
            </div>
            <div class="status-content">
              <div class="status-item">
                <span class="status-dot" [class.online]="connected()" [class.offline]="!connected()"></span>
                <span class="status-label">Backend API:</span>
                <span class="status-val" [class.success]="connected()" [class.error]="!connected()">
                  {{ connected() ? 'Connected' : 'Disconnected' }}
                </span>
              </div>
              <div class="status-item">
                <app-glass-icon name="storage" [size]="16" color="muted"></app-glass-icon>
                <span class="status-label">Archive Mount:</span>
                <span class="status-val mono">/export/home/dpower/archives</span>
              </div>
              <div class="status-item">
                <app-glass-icon name="timer" [size]="16" color="muted"></app-glass-icon>
                <span class="status-label">Stuck Timeout:</span>
                <span class="status-val">{{ data()?.stuckTimeoutMin ?? '—' }} min</span>
              </div>
              <hr class="divider">
              <div class="quick-tips">
                <h4><app-glass-icon name="lightbulb" [size]="18" color="warning"></app-glass-icon> Quick Tip</h4>
                <p>Reloading a lot will automatically decompress any .gz files and move them to the environment's inbox for ETL processing.</p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .dashboard-root { padding: 0.25rem; }
    .dashboard-header { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 2.5rem; }
    .dashboard-header h1 { margin: 0; font-size: 2.2rem; letter-spacing: -0.03em; font-weight: 800; }
    .subtitle { margin: 0.35rem 0 0 0; color: var(--text-muted); font-size: 1rem; }
    .last-updated { margin: 0.2rem 0 0 0; color: var(--text-muted); font-size: 0.8rem; opacity: 0.7; }
 
    .mb-6 { margin-bottom: 2rem; }
    
    .dashboard-grid {
      display: grid;
      grid-template-columns: 1.8fr 1.2fr;
      gap: 2rem;
      align-items: start;
    }

    .left-column, .right-column { display: flex; flex-direction: column; gap: 2rem; }

    /* Active Sessions */
    .session-list { display: flex; flex-direction: column; gap: 0.6rem; }
    .session-row {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.75rem 1rem;
      background: rgba(255,255,255,0.02);
      border-radius: 10px;
      border: 1px solid rgba(255,255,255,0.04);
      font-size: 0.875rem;
    }
    .session-id { font-family: 'JetBrains Mono', monospace; font-size: 0.8rem; color: var(--accent-color); min-width: 5rem; }
    .env-badge { font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; padding: 0.2rem 0.5rem; border-radius: 5px; background: color-mix(in srgb, var(--accent-color) 12%, transparent); color: var(--accent-color); white-space: nowrap; }
    .requester { flex: 1; color: var(--text-muted); font-size: 0.8rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .progress-wrap { display: flex; align-items: center; gap: 0.5rem; min-width: 8rem; }
    .progress-bar { flex: 1; height: 5px; border-radius: 3px; background: rgba(255,255,255,0.08); overflow: hidden; }
    .progress-fill { height: 100%; border-radius: 3px; background: var(--accent-color); transition: width 0.4s ease; }
    .progress-pct { font-size: 0.75rem; color: var(--text-muted); min-width: 2.5rem; text-align: right; }
    .status-badge { font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; padding: 0.2rem 0.5rem; border-radius: 5px; white-space: nowrap; }
    .status-processing { color: var(--accent-color); background: color-mix(in srgb, var(--accent-color) 12%, transparent); }
    .status-created { color: var(--warning); background: color-mix(in srgb, var(--warning) 12%, transparent); }
    .footer-link { font-size: 0.85rem; color: var(--accent-color); text-decoration: none; font-weight: 600; opacity: 0.85; transition: opacity 0.2s; }
    .footer-link:hover { opacity: 1; }
 
    .glass-panel { padding: 2rem; }
 
    .panel-header { display: flex; align-items: center; gap: 1rem; margin-bottom: 1.75rem; }
    .panel-header h3 { margin: 0; font-size: 1.25rem; font-weight: 700; letter-spacing: -0.01em; }
 
    .lot-list { display: flex; flex-direction: column; gap: 0.75rem; }
    .lot-item {
      display: flex;
      align-items: center;
      gap: 1.25rem;
      padding: 1rem 1.25rem;
      background: rgba(255, 255, 255, 0.02);
      border-radius: 12px;
      border: 1px solid rgba(255, 255, 255, 0.04);
      transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .lot-item:hover { 
      background: color-mix(in srgb, var(--accent-color) 6%, transparent); 
      border-color: color-mix(in srgb, var(--accent-color) 20%, transparent);
      transform: translateX(4px);
    }
    .lot-name { flex: 1; font-weight: 600; font-family: 'JetBrains Mono', monospace; font-size: 0.95rem; color: var(--text-main); }
    .lot-badge { font-size: 0.65rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; color: var(--success); background: color-mix(in srgb, var(--success) 10%, transparent); padding: 0.25rem 0.6rem; border-radius: 6px; border: 1px solid color-mix(in srgb, var(--success) 20%, transparent); }
 
    .panel-footer { margin-top: 1.75rem; display: flex; justify-content: flex-end; }
 
    .status-content { display: flex; flex-direction: column; gap: 1.25rem; }
    .status-item { display: flex; align-items: center; gap: 1rem; font-size: 0.95rem; }
    .status-dot { width: 10px; height: 10px; border-radius: 50%; background: #94a3b8; position: relative; }
    .status-dot.online { 
      background: var(--success); 
      box-shadow: 0 0 12px var(--success);
      &::after {
        content: '';
        position: absolute;
        inset: -4px;
        border-radius: 50%;
        background: var(--success);
        opacity: 0.2;
        animation: pulse 2s infinite;
      }
    }
    .status-dot.offline { background: var(--error); box-shadow: 0 0 8px var(--error); }
    .status-label { color: var(--text-muted); font-weight: 500; min-width: 120px; }
    .status-val { font-weight: 700; color: var(--text-main); }
    .status-val.success { color: var(--success); }
    .status-val.error { color: var(--error); }
    .status-val.mono { font-family: monospace; font-size: 0.85rem; opacity: 0.9; }
 
    .divider { border: 0; border-top: 1px solid rgba(255, 255, 255, 0.08); margin: 0.75rem 0; }
    .quick-tips { background: rgba(245, 158, 11, 0.03); padding: 1.25rem; border-radius: 12px; border: 1px solid rgba(245, 158, 11, 0.1); }
    .quick-tips h4 { margin: 0 0 0.75rem 0; font-size: 1rem; color: var(--warning); font-weight: 700; display: flex; align-items: center; gap: 0.5rem; }
    .quick-tips p { margin: 0; font-size: 0.9rem; color: var(--text-muted); line-height: 1.6; }
 
    .empty-state { text-align: center; color: var(--text-muted); padding: 3rem; font-style: italic; font-size: 1rem; }

    /* Quick Actions */
    .actions-list { display: flex; flex-direction: column; gap: 1.25rem; }
    .action-item { display: flex; flex-direction: column; gap: 0.5rem; }
    .action-item app-glass-button { width: 100%; }
    .action-item app-glass-button ::ng-deep .glass-btn { width: 100%; justify-content: flex-start; gap: 0.75rem; }
    .action-desc { margin: 0; font-size: 0.8rem; color: var(--text-muted); padding-left: 0.25rem; line-height: 1.4; }
 
    @keyframes pulse {
      0% { transform: scale(1); opacity: 0.4; }
      70% { transform: scale(2.5); opacity: 0; }
      100% { transform: scale(1); opacity: 0; }
    }
 
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    @keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
    .animated { animation-duration: 0.6s; animation-fill-mode: both; }
    .fadeIn { animation-name: fadeIn; }
    .slideUp { animation-name: slideUp; }
 
    @media (max-width: 1100px) {
      .dashboard-grid { grid-template-columns: 1fr; }
      .left-column, .right-column { gap: 1.5rem; }
    }
  `]
})
export class XfcsDashboardComponent implements OnInit {
  data = signal<DashboardData | undefined>(undefined);
  activeSessions = signal<ReloadStatus[]>([]);
  loading = signal(false);
  refreshing = signal(false);
  connected = signal(true);
  lastUpdated = signal<Date | undefined>(undefined);

  private readonly destroyRef = inject(DestroyRef);

  constructor(private api: XfcsApiService, private toast: ToastService) {}

  ngOnInit() {
    this.loadDashboard();
    interval(30000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.loadDashboard(true));
  }

  calcProgress(s: ReloadStatus): number {
    if (!s.totalFiles) return 0;
    const done = (s.completedFiles ?? 0) + (s.failedFiles ?? 0);
    return Math.min(100, Math.round((done / s.totalFiles) * 100));
  }

  loadDashboard(isRefresh = false) {
    if (isRefresh) {
      this.refreshing.set(true);
    } else {
      this.loading.set(true);
    }

    forkJoin({
      dashboard: this.api.getDashboard(),
      sessions: this.api.getSessions()
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: ({ dashboard, sessions }) => {
        this.data.set(dashboard);
        this.activeSessions.set(
          sessions.filter(s => s.status === 'processing' || s.status === 'created')
        );
        this.connected.set(true);
        this.lastUpdated.set(new Date());
        this.loading.set(false);
        this.refreshing.set(false);
      },
      error: () => {
        this.toast.error('Failed to load dashboard metrics');
        this.connected.set(false);
        this.loading.set(false);
        this.refreshing.set(false);
      }
    });
  }
}
