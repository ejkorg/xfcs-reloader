import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  ViewChild,
  computed,
  signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { XfcsApiService } from '../api/xfcs-api.service';
import { FileCoveragePoint, EnvYearRange } from '../api/xfcs-models';
import { GlassSelectComponent, GlassOption } from '../shared/components/glass-select.component';
import * as echarts from 'echarts';
import type { ECharts, EChartsOption } from 'echarts';

@Component({
  selector: 'app-xfcs-coverage',
  standalone: true,
  imports: [CommonModule, FormsModule, GlassSelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="coverage-root">
      <header class="coverage-header">
        <div class="title-group">
          <h1>xFCS <span class="accent">File Coverage</span></h1>
          <p class="subtitle">Date-coverage report of files staged, enqueued, completed, and failed over time.</p>
        </div>
      </header>

      <!-- Filter bar -->
      <div class="filter-bar glass-panel">
        <div class="filter-group">
          <label>Environment</label>
          <app-glass-select
            [options]="envOptions()"
            [(ngModel)]="selectedEnv"
            (ngModelChange)="loadEnvs()">
          </app-glass-select>
        </div>
        <div class="filter-group">
          <label>Granularity</label>
          <app-glass-select
            [options]="granularityOptions"
            [(ngModel)]="granularity">
          </app-glass-select>
        </div>
        <div class="filter-group">
          <label>Date From</label>
          <input type="date" [(ngModel)]="dateFrom" />
        </div>
        <div class="filter-group">
          <label>Date To</label>
          <input type="date" [(ngModel)]="dateTo" />
        </div>
        <button class="run-btn" (click)="runReport()" [disabled]="loading()">
          <span>▶</span> {{ loading() ? 'Loading...' : 'Run Report' }}
        </button>
      </div>

      <!-- KPI row -->
      <div class="kpi-row" *ngIf="data().length > 0 && !loading()">
        <div class="kpi-card glass-panel">
          <div class="kpi-body">
            <div class="kpi-value">{{ kpis().total }}</div>
            <div class="kpi-label">Total Files</div>
          </div>
        </div>
        <div class="kpi-card glass-panel">
          <div class="kpi-body">
            <div class="kpi-value success">{{ kpis().done }}</div>
            <div class="kpi-label">Completed</div>
          </div>
        </div>
        <div class="kpi-card glass-panel">
          <div class="kpi-body">
            <div class="kpi-value danger">{{ kpis().failed }}</div>
            <div class="kpi-label">Failed</div>
          </div>
        </div>
        <div class="kpi-card glass-panel">
          <div class="kpi-body">
            <div class="kpi-value warning">{{ kpis().staged }}</div>
            <div class="kpi-label">Pending (Staged)</div>
          </div>
        </div>
        <div class="kpi-card glass-panel">
          <div class="kpi-body">
            <div class="kpi-value accent">{{ kpis().enqueued }}</div>
            <div class="kpi-label">In Progress</div>
          </div>
        </div>
        <div class="kpi-card glass-panel">
          <div class="kpi-body">
            <div class="kpi-value" [class.success]="kpis().completionRate >= 90" [class.warning]="kpis().completionRate >= 70 && kpis().completionRate < 90" [class.danger]="kpis().completionRate < 70">
              {{ kpis().completionRate }}%
            </div>
            <div class="kpi-label">Completion Rate</div>
          </div>
        </div>
      </div>

      <!-- Loading skeleton -->
      <div class="kpi-row" *ngIf="loading()">
        <div class="kpi-card glass-panel skeleton" *ngFor="let i of [1,2,3,4,5,6]"></div>
      </div>

      <!-- Error -->
      <div class="error-banner glass-panel" *ngIf="error()">
        <span>⚠ {{ error() }}</span>
        <button class="retry-btn" (click)="runReport()">Retry</button>
      </div>

      <!-- Stacked bar chart -->
      <div class="chart-section" *ngIf="data().length > 0 && !loading()">
        <div class="chart-card glass-panel">
          <div class="chart-title">File Status Distribution Over Time</div>
          <div class="chart-container" #coverageChartRef></div>
        </div>
      </div>

      <!-- Detail table -->
      <div class="table-section" *ngIf="data().length > 0 && !loading()">
        <div class="table-toolbar">
          <span class="table-title">Coverage Details</span>
          <span class="table-count">{{ data().length }} buckets</span>
        </div>
        <div class="table-wrap">
          <table class="coverage-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Environment</th>
                <th class="num">Total</th>
                <th class="num">Completed</th>
                <th class="num">In Progress</th>
                <th class="num">Pending</th>
                <th class="num">Failed</th>
                <th class="num">Rate</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let p of data()">
                <td class="mono">{{ p.bucket }}</td>
                <td>{{ p.environment }}</td>
                <td class="num">{{ p.total }}</td>
                <td class="num success">{{ p.done }}</td>
                <td class="num accent">{{ p.enqueued }}</td>
                <td class="num warning">{{ p.staged }}</td>
                <td class="num danger">{{ p.failed }}</td>
                <td class="num">{{ p.done > 0 || p.failed > 0 ? ((p.done / (p.done + p.failed)) * 100 | number:'1.0-0') : '-' }}</td>
              </tr>
              <tr *ngIf="data().length === 0">
                <td colspan="8" class="empty-row">No data matching the filters.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- No data state -->
      <div class="no-data glass-panel" *ngIf="!loading() && data().length === 0 && !error()">
        <p>No coverage data available. Click <strong>Run Report</strong> to load the report.</p>
      </div>
    </div>
  `,
  styles: [`
    .coverage-root { padding: 0.25rem; }

    .coverage-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      margin-bottom: 1.5rem;
    }
    .coverage-header h1 { margin: 0; font-size: 2.2rem; letter-spacing: -0.03em; font-weight: 800; }
    .subtitle { margin: 0.35rem 0 0; color: var(--text-muted); font-size: 1rem; }

    /* Filter bar */
    .filter-bar {
      display: flex;
      align-items: flex-end;
      gap: 1rem;
      padding: 1rem 1.5rem;
      margin-bottom: 1.5rem;
      flex-wrap: wrap;
    }
    .filter-group {
      display: flex;
      flex-direction: column;
      gap: 0.3rem;
    }
    .filter-group label {
      font-size: 0.68rem; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.08em; color: var(--text-muted);
    }
    .filter-group input {
      padding: 0.45rem 0.7rem;
      border-radius: 8px;
      border: 1px solid var(--card-border);
      background: rgba(255, 255, 255, 0.05);
      color: var(--text-main);
      font-size: 0.85rem;
      min-width: 130px;
      outline: none;
      font-family: inherit;
      transition: border-color 0.15s ease;
    }
    .filter-group input:focus {
      border-color: rgba(167, 139, 250, 0.5);
      box-shadow: 0 0 0 2px rgba(167, 139, 250, 0.15);
    }
    :host-context(body.light-theme) .filter-group input {
      background: #ffffff;
      color: #0f172a;
      border-color: rgba(15, 23, 42, 0.2);
    }
    /* Compact glass-select inside filter groups */
    ::ng-deep .filter-group .glass-select-container .select-trigger {
      min-height: 40px !important;
      padding: 0.4rem 0.8rem !important;
      border-radius: 10px !important;
      background: rgba(255, 255, 255, 0.04) !important;
      border-color: rgba(167, 139, 250, 0.2) !important;
      min-width: 130px;
    }
    ::ng-deep .filter-group .glass-select-container.is-open .select-trigger {
      border-color: var(--accent-color) !important;
      box-shadow: 0 0 12px rgba(129, 140, 248, 0.2) !important;
    }
    ::ng-deep .filter-group .selected-label {
      font-size: 0.85rem !important;
      font-weight: 500 !important;
    }
    ::ng-deep .filter-group .placeholder {
      font-size: 0.85rem !important;
    }
    :host-context(body.light-theme) ::ng-deep .filter-group .select-trigger {
      background: rgba(99, 102, 241, 0.04) !important;
      border-color: rgba(99, 102, 241, 0.2) !important;
    }
    .run-btn {
      display: flex; align-items: center; gap: 0.4rem;
      padding: 0.5rem 1.2rem; border-radius: 10px;
      border: 1px solid var(--accent-color);
      background: color-mix(in srgb, var(--accent-color) 14%, transparent);
      color: var(--accent-color);
      font-size: 0.85rem; font-weight: 700; cursor: pointer;
      transition: all 0.2s ease;
      &:hover:not(:disabled) { background: color-mix(in srgb, var(--accent-color) 25%, transparent); }
      &:disabled { opacity: 0.5; cursor: not-allowed; }
    }

    /* KPI row */
    .kpi-row {
      display: grid;
      grid-template-columns: repeat(6, 1fr);
      gap: 1.25rem;
      margin-bottom: 1.5rem;
    }
    .kpi-card {
      display: flex; align-items: center;
      padding: 1.1rem 1.25rem;
      transition: transform 0.25s ease;
      &:hover { transform: translateY(-3px); }
    }
    .kpi-card.skeleton {
      height: 72px;
      background: linear-gradient(90deg, rgba(255,255,255,0.03) 25%, rgba(255,255,255,0.07) 50%, rgba(255,255,255,0.03) 75%);
      background-size: 200% 100%;
      animation: shimmer 1.4s infinite;
    }
    .kpi-body { flex: 1; min-width: 0; }
    .kpi-value {
      font-size: 1.75rem; font-weight: 800; line-height: 1;
      letter-spacing: -0.04em; color: var(--text-main);
    }
    .kpi-value.success { color: #10b981; }
    .kpi-value.danger  { color: #ef4444; }
    .kpi-value.warning { color: #f59e0b; }
    .kpi-value.accent  { color: var(--accent-color); }
    .kpi-label {
      font-size: 0.65rem; font-weight: 800; text-transform: uppercase;
      letter-spacing: 0.1em; color: var(--text-muted); margin-top: 0.35rem;
    }

    /* Chart */
    .chart-section { margin-bottom: 1.5rem; }
    .chart-card { padding: 1.5rem; }
    .chart-title {
      font-size: 0.8rem; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.08em; color: var(--text-muted); margin-bottom: 1rem;
    }
    .chart-container { height: 300px; width: 100%; }

    /* Table */
    .table-section { margin-bottom: 2rem; }
    .table-toolbar {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 0.75rem;
    }
    .table-title {
      font-size: 0.8rem; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.08em; color: var(--text-muted);
    }
    .table-count {
      font-size: 0.75rem; color: var(--text-muted);
    }
    .table-wrap {
      overflow-x: auto;
      border-radius: 12px;
      border: 1px solid var(--card-border);
    }
    .coverage-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.85rem;
    }
    .coverage-table th {
      background: color-mix(in srgb, var(--card-bg) 94%, transparent);
      text-align: left;
      padding: 0.65rem 1rem;
      font-size: 0.7rem; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.08em; color: var(--text-muted);
      border-bottom: 1px solid var(--card-border);
    }
    .coverage-table td {
      padding: 0.6rem 1rem;
      border-bottom: 1px solid var(--card-border);
      color: var(--text-main);
    }
    .coverage-table tr:last-child td { border-bottom: none; }
    .coverage-table tr:hover td { background: rgba(255,255,255,0.02); }
    .coverage-table .num { text-align: right; font-variant-numeric: tabular-nums; }
    .coverage-table .mono { font-family: 'SF Mono', 'Fira Code', monospace; }
    .coverage-table .success { color: #10b981; }
    .coverage-table .danger  { color: #ef4444; }
    .coverage-table .warning { color: #f59e0b; }
    .coverage-table .accent  { color: var(--accent-color); }
    .coverage-table .empty-row {
      text-align: center; padding: 2rem; color: var(--text-muted);
    }

    /* Error */
    .error-banner {
      display: flex; align-items: center; justify-content: space-between;
      padding: 1rem 1.5rem; margin-bottom: 1.5rem;
      color: #f87171; border-color: rgba(239,68,68,0.2);
      background: rgba(239,68,68,0.06);
    }
    .retry-btn {
      padding: 0.35rem 0.9rem; border-radius: 8px;
      border: 1px solid rgba(239,68,68,0.3); background: rgba(239,68,68,0.1);
      color: #f87171; font-size: 0.8rem; font-weight: 600; cursor: pointer;
    }

    /* No data */
    .no-data {
      padding: 3rem; text-align: center;
      color: var(--text-muted); font-size: 1rem;
    }

    @keyframes shimmer { to { background-position: -200% 0; } }

    @media (max-width: 1200px) {
      .kpi-row { grid-template-columns: repeat(3, 1fr); }
    }
    @media (max-width: 800px) {
      .kpi-row { grid-template-columns: repeat(2, 1fr); }
    }
  `]
})
export class XfcsCoverageComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('coverageChartRef') coverageChartRef?: ElementRef<HTMLDivElement>;

  envs = signal<EnvYearRange[]>([]);
  data = signal<FileCoveragePoint[]>([]);
  loading = signal(false);
  error = signal<string | null>(null);
  selectedEnv = '';
  granularity = 'day';
  dateFrom = '';
  dateTo = '';

  readonly granularityOptions: GlassOption[] = [
    { value: 'day',   label: 'Day' },
    { value: 'week',  label: 'Week' },
    { value: 'month', label: 'Month' },
  ];
  readonly envOptions = computed(() => [
    { value: '', label: 'All Environments' } as GlassOption,
    ...this.envs().map(e => ({ value: e.environment, label: e.environment }) as GlassOption)
  ]);

  private chart?: ECharts;
  private renderTimeout?: ReturnType<typeof setTimeout>;
  private isViewReady = false;

  readonly kpis = () => {
    const points = this.data();
    const total = points.reduce((s, p) => s + p.total, 0);
    const done = points.reduce((s, p) => s + p.done, 0);
    const failed = points.reduce((s, p) => s + p.failed, 0);
    const staged = points.reduce((s, p) => s + p.staged, 0);
    const enqueued = points.reduce((s, p) => s + p.enqueued, 0);
    const denom = done + failed;
    const completionRate = denom > 0 ? Math.round((done / denom) * 1000) / 10 : 100;
    return { total, done, failed, staged, enqueued, completionRate };
  };

  constructor(private api: XfcsApiService) {}

  ngOnInit(): void {
    this.loadEnvs();
    this.runReport();
  }

  ngAfterViewInit(): void {
    this.isViewReady = true;
    this.scheduleRender();
  }

  ngOnDestroy(): void {
    if (this.renderTimeout) clearTimeout(this.renderTimeout);
    this.chart?.dispose();
  }

  @HostListener('window:resize')
  onResize(): void {
    this.chart?.resize();
  }

  loadEnvs(): void {
    this.api.getEnvs().subscribe({
      next: (envs) => this.envs.set(envs),
      error: () => this.envs.set([])
    });
  }

  /** Normalize a local date (YYYY-MM-DD) to a UTC ISO string (YYYY-MM-DDT00:00:00Z). */
  private toUtcDate(dateStr: string): string | undefined {
    if (!dateStr) return undefined;
    return `${dateStr}T00:00:00Z`;
  }

  runReport(): void {
    this.loading.set(true);
    this.error.set(null);

    this.api.getFileCoverage(
      this.selectedEnv || undefined,
      this.granularity,
      this.toUtcDate(this.dateFrom),
      this.toUtcDate(this.dateTo)
    ).subscribe({
      next: (points) => {
        this.data.set(points);
        this.loading.set(false);
        this.scheduleRender();
      },
      error: () => {
        this.loading.set(false);
        this.error.set('Failed to load coverage data. Please retry.');
      }
    });
  }

  private scheduleRender(): void {
    if (!this.isViewReady) return;
    if (this.renderTimeout) clearTimeout(this.renderTimeout);
    this.renderTimeout = setTimeout(() => this.renderChart(), 0);
  }

  private renderChart(): void {
    if (!this.coverageChartRef || this.data().length === 0) return;
    this.chart = this.initChart(this.chart, this.coverageChartRef);

    const points = this.data();
    const labels = points.map(p => p.bucket);

    const option: EChartsOption = {
      tooltip: {
        trigger: 'axis',
        formatter: (params: any) => {
          if (!Array.isArray(params)) return '';
          let html = `<b>${params[0].axisValue}</b>`;
          let total = 0;
          for (const p of params) {
            html += `<br/>${p.marker} ${p.seriesName}: <b>${p.value}</b>`;
            total += Number(p.value);
          }
          html += `<br/>Total: <b>${total}</b>`;
          return html;
        }
      },
      legend: {
        top: 0,
        textStyle: { color: '#9ca3af' }
      },
      grid: {
        left: 12, right: 12, top: 40, bottom: 28,
        containLabel: true
      },
      xAxis: {
        type: 'category',
        data: labels,
        axisLabel: { color: '#9ca3af' }
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: '#9ca3af' },
        splitLine: { lineStyle: { color: 'rgba(148,163,184,0.15)' } }
      },
      series: [
        {
          name: 'Completed',
          type: 'bar',
          stack: 'coverage',
          data: points.map(p => p.done),
          itemStyle: { color: '#10b981' }
        },
        {
          name: 'In Progress',
          type: 'bar',
          stack: 'coverage',
          data: points.map(p => p.enqueued),
          itemStyle: { color: '#818cf8' }
        },
        {
          name: 'Pending',
          type: 'bar',
          stack: 'coverage',
          data: points.map(p => p.staged),
          itemStyle: { color: '#f59e0b' }
        },
        {
          name: 'Failed',
          type: 'bar',
          stack: 'coverage',
          data: points.map(p => p.failed),
          itemStyle: { color: '#ef4444' }
        }
      ]
    };

    this.chart.setOption(option, true);
  }

  private initChart(existing: ECharts | undefined, ref: ElementRef<HTMLDivElement>): ECharts {
    if (existing) return existing;
    return echarts.getInstanceByDom(ref.nativeElement) ?? echarts.init(ref.nativeElement, undefined, { renderer: 'canvas' });
  }
}
