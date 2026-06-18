import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GlassIconComponent } from '../shared/components/glass-icon.component';
import { DashboardData, ReloadStatus } from '../api/xfcs-models';

interface StatCard {
  icon: string;
  iconColor: 'primary' | 'success' | 'warning' | 'error' | 'muted';
  label: string;
  value: number;
  variant?: 'normal' | 'success' | 'danger';
  iconBg: string;
  pulse?: boolean;
}

@Component({
  standalone: true,
  selector: 'app-xfcs-stats',
  imports: [CommonModule, GlassIconComponent],
  template: `
    <div class="stats-grid">
      <article class="stat-card glass-panel"
               *ngFor="let card of statCards; trackBy: trackByLabel">
        <div class="stat-icon-wrap" [style.background]="card.iconBg">
          <app-glass-icon [name]="card.icon" [size]="24" [color]="card.iconColor"></app-glass-icon>
        </div>
        <div class="stat-body">
          <div class="stat-value-row">
            <div *ngIf="loading" class="skeleton-val"></div>
            <div *ngIf="!loading"
              class="stat-value"
              [class.success-val]="card.variant === 'success'"
              [class.danger-val]="card.variant === 'danger'">
              {{ card.value }}
            </div>
            <span class="pulse-dot" *ngIf="!loading && card.pulse && card.value > 0" title="Active"></span>
          </div>
          <div class="stat-label">{{ card.label }}</div>
        </div>
      </article>
    </div>
  `,
  styles: [`
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(6, 1fr);
      gap: 1.25rem;
    }

    .stat-card {
      display: flex;
      align-items: center;
      gap: 1.25rem;
      padding: 1.5rem;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .stat-card:hover {
      transform: translateY(-4px) scale(1.02);
      box-shadow: 0 12px 24px rgba(0, 0, 0, 0.2);
      border-color: rgba(255, 255, 255, 0.1);
    }

    .stat-icon-wrap {
      width: 52px;
      height: 52px;
      border-radius: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      box-shadow: inset 0 0 12px rgba(255, 255, 255, 0.05);
    }

    .stat-body { flex: 1; min-width: 0; }

    .stat-value-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .stat-value {
      font-size: 2rem;
      font-weight: 800;
      line-height: 1;
      letter-spacing: -0.04em;
      color: var(--text-main);
    }

    .stat-value.success-val { color: var(--success); text-shadow: 0 0 15px rgba(16, 185, 129, 0.2); }
    .stat-value.danger-val  { color: var(--error); text-shadow: 0 0 15px rgba(239, 68, 68, 0.2); }

    .pulse-dot {
      width: 9px;
      height: 9px;
      border-radius: 50%;
      background: var(--accent-color);
      box-shadow: 0 0 6px rgba(129, 140, 248, 0.7);
      animation: activePulse 1.6s ease infinite;
      flex-shrink: 0;
    }

    .stat-label {
      font-size: 0.7rem;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--text-muted);
      margin-top: 0.5rem;
    }

    @keyframes activePulse {
      0%, 100% { opacity: 1; box-shadow: 0 0 6px rgba(129, 140, 248, 0.7); }
      50%       { opacity: 0.5; box-shadow: 0 0 12px rgba(129, 140, 248, 0.3); }
    }

    @media (max-width: 1400px) {
      .stats-grid { grid-template-columns: repeat(3, 1fr); }
    }

    @media (max-width: 900px) {
      .stats-grid { grid-template-columns: repeat(2, 1fr); }
    }

    @media (max-width: 600px) {
      .stats-grid { gap: 0.75rem; }
      .stat-card { padding: 1rem; gap: 0.75rem; }
      .stat-value { font-size: 1.5rem; }
    }

    .skeleton-val {
      width: 3rem;
      height: 2rem;
      border-radius: 6px;
      background: linear-gradient(90deg, rgba(255,255,255,0.04) 25%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.04) 75%);
      background-size: 200% 100%;
      animation: shimmer 1.4s infinite;
    }

    @keyframes shimmer { to { background-position: -200% 0; } }
  `]
})
export class XfcsStatsComponent {
  @Input() dashboard?: DashboardData;
  @Input() lastStatus?: ReloadStatus;
  @Input() loading: boolean = false;

  get queuedCount(): number {
    if (!this.lastStatus) return 0;
    const t = this.lastStatus.totalFiles ?? 0;
    const d = this.lastStatus.completedFiles ?? 0;
    const f = this.lastStatus.failedFiles ?? 0;
    return Math.max(0, t - d - f);
  }

  get statCards(): StatCard[] {
    return [
      {
        icon: 'dashboard',
        iconColor: 'primary',
        iconBg: 'rgba(129, 140, 248, 0.14)',
        label: 'Total Sessions',
        value: this.dashboard?.totalRequests ?? 0,
        variant: 'normal'
      },
      {
        icon: 'check_circle',
        iconColor: 'success',
        iconBg: 'rgba(16, 185, 129, 0.14)',
        label: 'Completed',
        value: this.dashboard?.completed ?? 0,
        variant: 'success'
      },
      {
        icon: 'error',
        iconColor: 'error',
        iconBg: 'rgba(239, 68, 68, 0.14)',
        label: 'Failed',
        value: this.dashboard?.failed ?? 0,
        variant: 'danger'
      },
      {
        icon: 'clock',
        iconColor: 'warning',
        iconBg: 'rgba(245, 158, 11, 0.14)',
        label: 'Queued',
        value: this.queuedCount,
        variant: 'normal'
      },
      {
        icon: 'sensors',
        iconColor: 'primary',
        iconBg: 'rgba(129, 140, 248, 0.14)',
        label: 'Active Sessions',
        value: this.dashboard?.activeSessions ?? 0,
        variant: 'normal',
        pulse: true
      },
      {
        icon: 'pending',
        iconColor: 'warning',
        iconBg: 'rgba(245, 158, 11, 0.14)',
        label: 'Pending Files',
        value: this.dashboard?.pendingFiles ?? 0,
        variant: 'normal'
      }
    ];
  }

  trackByLabel(index: number, card: StatCard) {
    return card.label;
  }
}
