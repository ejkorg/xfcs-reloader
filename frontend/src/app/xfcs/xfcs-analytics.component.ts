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
import { RouterModule } from '@angular/router';
import { Subscription, timer } from 'rxjs';
import { XfcsApiService } from '../api/xfcs-api.service';
import { DashboardData, ReloadStatus } from '../api/xfcs-models';
import * as echarts from 'echarts';
import type { ECharts, EChartsOption } from 'echarts';

interface AnalyticsSample {
  timestamp: number;
  totalSessions: number;
  completed: number;
  failed: number;
  activeSessions: number;
  pendingFiles: number;
}

@Component({
  selector: 'app-xfcs-analytics',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="analytics-root">
      <header class="analytics-header">
        <div class="title-group">
          <h1>xFCS <span class="accent">Analytics</span></h1>
          <p class="subtitle">Session trends, success rates, and file throughput over time.</p>
          <p class="last-updated" *ngIf="lastUpdated()">
            Last updated: {{ lastUpdated() | date:'medium' }}
          </p>
        </div>
        <div class="header-actions">
          <button class="refresh-btn" (click)="refresh()" [disabled]="loading()">
            <span class="refresh-icon">↻</span>
            Refresh
          </button>
        </div>
      </header>

      <!-- KPI row -->
      <div class="kpi-row" *ngIf="!loading() && snapshot()">
        <div class="kpi-card glass-panel">
          <div class="kpi-icon" style="background:rgba(129,140,248,0.14)">📦</div>
          <div class="kpi-body">
            <div class="kpi-value">{{ snapshot()!.totalRequests }}</div>
            <div class="kpi-label">Total Sessions</div>
          </div>
        </div>
        <div class="kpi-card glass-panel">
          <div class="kpi-icon" style="background:rgba(16,185,129,0.14)">✓</div>
          <div class="kpi-body">
            <div class="kpi-value success">{{ snapshot()!.completed }}</div>
            <div class="kpi-label">Completed</div>
          </div>
        </div>
        <div class="kpi-card glass-panel">
          <div class="kpi-icon" style="background:rgba(239,68,68,0.14)">✕</div>
          <div class="kpi-body">
            <div class="kpi-value danger">{{ snapshot()!.failed }}</div>
            <div class="kpi-label">Failed</div>
          </div>
        </div>
        <div class="kpi-card glass-panel">
          <div class="kpi-icon" style="background:rgba(129,140,248,0.14)">⚡</div>
          <div class="kpi-body">
            <div class="kpi-value accent">{{ snapshot()!.activeSessions }}</div>
            <div class="kpi-label">Active Now</div>
          </div>
        </div>
        <div class="kpi-card glass-panel">
          <div class="kpi-icon" style="background:rgba(245,158,11,0.14)">📄</div>
          <div class="kpi-body">
            <div class="kpi-value warning">{{ snapshot()!.pendingFiles }}</div>
            <div class="kpi-label">Pending Files</div>
          </div>
        </div>
        <div class="kpi-card glass-panel">
          <div class="kpi-icon" style="background:rgba(16,185,129,0.14)">%</div>
          <div class="kpi-body">
            <div class="kpi-value" [class.success]="successRate() >= 90" [class.warning]="successRate() < 90 && successRate() >= 70" [class.danger]="successRate() < 70">
              {{ successRate() }}%
            </div>
            <div class="kpi-label">Success Rate</div>
          </div>
        </div>
      </div>

      <!-- Loading skeleton -->
      <div class="kpi-row" *ngIf="loading()">
        <div class="kpi-card glass-panel skeleton" *ngFor="let i of [1,2,3,4,5,6]"></div>
      </div>

      <!-- Error state -->
      <div class="error-banner glass-panel" *ngIf="error()">
        <span>⚠ {{ error() }}</span>
        <button class="retry-btn" (click)="refresh()">Retry</button>
      </div>

      <!-- Charts grid -->
      <div class="charts-grid" *ngIf="hasData()">
        <div class="chart-card glass-panel">
          <div class="chart-title">Session Trend Over Time</div>
          <div class="chart-container" #trendChartRef></div>
        </div>
        <div class="chart-card glass-panel">
          <div class="chart-title">Success Rate Over Time</div>
          <div class="chart-container" #successRateChartRef></div>
        </div>
        <div class="chart-card glass-panel">
          <div class="chart-title">File Throughput (Completed / Interval)</div>
          <div class="chart-container" #throughputChartRef></div>
        </div>
        <div class="chart-card glass-panel">
          <div class="chart-title">Session Status Distribution</div>
          <div class="chart-container" #statusPieChartRef></div>
        </div>
      </div>

      <!-- No data state -->
      <div class="no-data glass-panel" *ngIf="!loading() && !hasData() && !error()">
        <p>No analytics data available yet. Start a reload session to see trends here.</p>
        <a routerLink="/reload/new" class="start-link">Start a Reload →</a>
      </div>
    </div>
  `,
  styles: [`
    .analytics-root { padding: 0.25rem; }

    .analytics-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      margin-bottom: 2rem;
    }
    .analytics-header h1 { margin: 0; font-size: 2.2rem; letter-spacing: -0.03em; font-weight: 800; }
    .subtitle { margin: 0.35rem 0 0; color: var(--text-muted); font-size: 1rem; }
    .last-updated { margin: 0.2rem 0 0; color: var(--text-muted); font-size: 0.8rem; opacity: 0.7; }

    .refresh-btn {
      display: flex; align-items: center; gap: 0.4rem;
      padding: 0.5rem 1.1rem; border-radius: 10px;
      border: 1px solid var(--card-border);
      background: var(--card-bg); color: var(--text-main);
      font-size: 0.875rem; font-weight: 600; cursor: pointer;
      transition: all 0.2s ease;
      &:hover:not(:disabled) { border-color: var(--accent-color); color: var(--accent-color); }
      &:disabled { opacity: 0.5; cursor: not-allowed; }
    }
    .refresh-icon { font-size: 1rem; }

    /* KPI row */
    .kpi-row {
      display: grid;
      grid-template-columns: repeat(6, 1fr);
      gap: 1.25rem;
      margin-bottom: 2rem;
    }
    .kpi-card {
      display: flex; align-items: center; gap: 1rem;
      padding: 1.25rem 1.5rem;
      transition: transform 0.25s ease;
      &:hover { transform: translateY(-3px); }
    }
    .kpi-card.skeleton {
      height: 80px;
      background: linear-gradient(90deg, rgba(255,255,255,0.03) 25%, rgba(255,255,255,0.07) 50%, rgba(255,255,255,0.03) 75%);
      background-size: 200% 100%;
      animation: shimmer 1.4s infinite;
    }
    .kpi-icon {
      width: 44px; height: 44px; border-radius: 12px;
      display: flex; align-items: center; justify-content: center;
      font-size: 1.2rem; flex-shrink: 0;
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
      font-size: 0.68rem; font-weight: 800; text-transform: uppercase;
      letter-spacing: 0.1em; color: var(--text-muted); margin-top: 0.4rem;
    }

    /* Charts */
    .charts-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1.5rem;
    }
    .chart-card { padding: 1.5rem; }
    .chart-title {
      font-size: 0.8rem; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.08em; color: var(--text-muted); margin-bottom: 1rem;
    }
    .chart-container { height: 240px; width: 100%; }

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
    .start-link {
      display: inline-block; margin-top: 1rem;
      color: var(--accent-color); font-weight: 600; text-decoration: none;
      &:hover { text-decoration: underline; }
    }

    @keyframes shimmer { to { background-position: -200% 0; } }

    @media (max-width: 1200px) {
      .kpi-row { grid-template-columns: repeat(3, 1fr); }
    }
    @media (max-width: 900px) {
      .kpi-row { grid-template-columns: repeat(2, 1fr); }
      .charts-grid { grid-template-columns: 1fr; }
    }
    @media (max-width: 600px) {
      .kpi-row { grid-template-columns: 1fr 1fr; }
    }
  `]
})
export class XfcsAnalyticsComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('trendChartRef') trendChartRef?: ElementRef<HTMLDivElement>;
  @ViewChild('successRateChartRef') successRateChartRef?: ElementRef<HTMLDivElement>;
  @ViewChild('throughputChartRef') throughputChartRef?: ElementRef<HTMLDivElement>;
  @ViewChild('statusPieChartRef') statusPieChartRef?: ElementRef<HTMLDivElement>;

  snapshot = signal<DashboardData | null>(null);
  sessions = signal<ReloadStatus[]>([]);
  loading = signal(false);
  error = signal<string | null>(null);
  lastUpdated = signal<Date | null>(null);
  history = signal<AnalyticsSample[]>([]);

  private readonly maxHistory = 120;
  private pollSub?: Subscription;
  private renderTimeout?: ReturnType<typeof setTimeout>;
  private isViewReady = false;

  private trendChart?: ECharts;
  private successRateChart?: ECharts;
  private throughputChart?: ECharts;
  private statusPieChart?: ECharts;

  readonly successRate = computed(() => {
    const s = this.snapshot();
    if (!s) return 100;
    const denom = s.completed + s.failed;
    if (denom <= 0) return 100;
    return Math.round((s.completed / denom) * 1000) / 10;
  });

  constructor(private api: XfcsApiService) {}

  ngOnInit(): void {
    this.refresh();
    this.pollSub = timer(30000, 30000).subscribe(() => this.load(false));
  }

  ngAfterViewInit(): void {
    this.isViewReady = true;
    this.scheduleRender();
  }

  ngOnDestroy(): void {
    this.pollSub?.unsubscribe();
    if (this.renderTimeout) clearTimeout(this.renderTimeout);
    this.disposeCharts();
  }

  refresh(): void { this.load(true); }

  @HostListener('window:resize')
  onResize(): void {
    this.trendChart?.resize();
    this.successRateChart?.resize();
    this.throughputChart?.resize();
    this.statusPieChart?.resize();
  }

  hasData(): boolean {
    const s = this.snapshot();
    return !!s && (s.totalRequests > 0 || this.history().length > 1);
  }

  private load(showLoading: boolean): void {
    if (showLoading) this.loading.set(true);

    this.api.getDashboard().subscribe({
      next: (data: DashboardData) => {
        this.snapshot.set(data);
        this.lastUpdated.set(new Date());
        this.error.set(null);
        this.loading.set(false);
        this.appendHistory(data);
        this.scheduleRender();
      },
      error: () => {
        this.loading.set(false);
        this.error.set('Unable to load analytics data. Please retry.');
      }
    });
  }

  private appendHistory(data: DashboardData): void {
    const sample: AnalyticsSample = {
      timestamp: Date.now(),
      totalSessions: data.totalRequests,
      completed: data.completed,
      failed: data.failed,
      activeSessions: data.activeSessions,
      pendingFiles: data.pendingFiles
    };
    this.history.update((h: AnalyticsSample[]) => {
      const updated = [...h, sample];
      if (updated.length > this.maxHistory) updated.shift();
      return updated;
    });
  }

  private scheduleRender(): void {
    if (!this.isViewReady) return;
    if (this.renderTimeout) clearTimeout(this.renderTimeout);
    this.renderTimeout = setTimeout(() => this.renderCharts(), 0);
  }

  private renderCharts(): void {
    if (!this.hasData()) return;
    this.renderTrendChart();
    this.renderSuccessRateChart();
    this.renderThroughputChart();
    this.renderStatusPieChart();
  }

  private renderTrendChart(): void {
    if (!this.trendChartRef) return;
    this.trendChart = this.initChart(this.trendChart, this.trendChartRef);
    const h = this.history();
    const xAxis = h.map((p: AnalyticsSample) => this.toShortTime(p.timestamp));
    const option: EChartsOption = {
      tooltip: { trigger: 'axis' },
      legend: { top: 0, textStyle: { color: '#9ca3af' } },
      grid: { left: 12, right: 12, top: 40, bottom: 28, containLabel: true },
      xAxis: { type: 'category', data: xAxis, axisLabel: { color: '#9ca3af' } },
      yAxis: { type: 'value', axisLabel: { color: '#9ca3af' }, splitLine: { lineStyle: { color: 'rgba(148,163,184,0.15)' } } },
      series: [
        { name: 'Total', type: 'line', smooth: true, data: h.map((p: AnalyticsSample) => p.totalSessions), lineStyle: { color: '#818cf8' } },
        { name: 'Completed', type: 'line', smooth: true, data: h.map((p: AnalyticsSample) => p.completed), lineStyle: { color: '#10b981' } },
        { name: 'Failed', type: 'line', smooth: true, data: h.map((p: AnalyticsSample) => p.failed), lineStyle: { color: '#ef4444' } },
        { name: 'Active', type: 'line', smooth: true, data: h.map((p: AnalyticsSample) => p.activeSessions), lineStyle: { color: '#f59e0b', type: 'dashed' } }
      ]
    };
    this.trendChart.setOption(option, true);
  }

  private renderSuccessRateChart(): void {
    if (!this.successRateChartRef) return;
    this.successRateChart = this.initChart(this.successRateChart, this.successRateChartRef);
    const h = this.history();
    const rates = h.map((p: AnalyticsSample) => {
      const denom = p.completed + p.failed;
      return denom > 0 ? Math.round((p.completed / denom) * 1000) / 10 : 100;
    });
    const option: EChartsOption = {
      tooltip: { trigger: 'axis', formatter: (params: any) => {
        const p = Array.isArray(params) ? params[0] : params;
        return `${p.name}<br/>${p.seriesName}: <b>${p.value}%</b>`;
      }},
      grid: { left: 12, right: 12, top: 24, bottom: 28, containLabel: true },
      xAxis: { type: 'category', data: h.map((p: AnalyticsSample) => this.toShortTime(p.timestamp)), axisLabel: { color: '#9ca3af' } },
      yAxis: { type: 'value', min: 0, max: 100, axisLabel: { color: '#9ca3af', formatter: '{value}%' }, splitLine: { lineStyle: { color: 'rgba(148,163,184,0.15)' } } },
      series: [{
        name: 'Success Rate', type: 'line', smooth: true,
        areaStyle: { color: 'rgba(16,185,129,0.1)' },
        lineStyle: { color: '#10b981', width: 2 },
        data: rates
      }]
    };
    this.successRateChart.setOption(option, true);
  }

  private renderThroughputChart(): void {
    if (!this.throughputChartRef) return;
    this.throughputChart = this.initChart(this.throughputChart, this.throughputChartRef);
    const h = this.history();
    const throughput = h.map((p: AnalyticsSample, i: number) => {
      if (i === 0) return 0;
      const prev = h[i - 1];
      return Math.max(p.completed - prev.completed, 0);
    });
    const option: EChartsOption = {
      tooltip: { trigger: 'axis' },
      grid: { left: 12, right: 12, top: 24, bottom: 28, containLabel: true },
      xAxis: { type: 'category', data: h.map((p: AnalyticsSample) => this.toShortTime(p.timestamp)), axisLabel: { color: '#9ca3af' } },
      yAxis: { type: 'value', axisLabel: { color: '#9ca3af' }, splitLine: { lineStyle: { color: 'rgba(148,163,184,0.15)' } } },
      series: [{
        name: 'Files Completed', type: 'bar',
        data: throughput,
        itemStyle: { color: '#06b6d4', borderRadius: [4, 4, 0, 0] }
      }]
    };
    this.throughputChart.setOption(option, true);
  }

  private renderStatusPieChart(): void {
    if (!this.statusPieChartRef) return;
    this.statusPieChart = this.initChart(this.statusPieChart, this.statusPieChartRef);
    const s = this.snapshot();
    if (!s) return;
    const pending = Math.max(s.totalRequests - s.completed - s.failed - s.activeSessions, 0);
    const option: EChartsOption = {
      tooltip: { trigger: 'item' },
      legend: { orient: 'vertical', right: 0, top: 'middle', textStyle: { color: '#9ca3af' } },
      series: [{
        name: 'Sessions', type: 'pie',
        radius: ['45%', '72%'],
        center: ['34%', '50%'],
        avoidLabelOverlap: true,
        label: { color: '#e2e8f0' },
        data: [
          { name: 'Completed', value: s.completed, itemStyle: { color: '#10b981' } },
          { name: 'Failed', value: s.failed, itemStyle: { color: '#ef4444' } },
          { name: 'Active', value: s.activeSessions, itemStyle: { color: '#818cf8' } },
          { name: 'Pending', value: pending, itemStyle: { color: '#f59e0b' } }
        ].filter(d => d.value > 0)
      }]
    };
    this.statusPieChart.setOption(option, true);
  }

  private initChart(existing: ECharts | undefined, ref: ElementRef<HTMLDivElement>): ECharts {
    if (existing) return existing;
    return echarts.getInstanceByDom(ref.nativeElement) ?? echarts.init(ref.nativeElement, undefined, { renderer: 'canvas' });
  }

  private toShortTime(ts: number): string {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  private disposeCharts(): void {
    this.trendChart?.dispose();
    this.successRateChart?.dispose();
    this.throughputChart?.dispose();
    this.statusPieChart?.dispose();
    this.trendChart = this.successRateChart = this.throughputChart = this.statusPieChart = undefined;
  }
}
