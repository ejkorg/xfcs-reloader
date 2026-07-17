import {
  AfterViewInit,
  Component,
  OnDestroy,
  OnInit,
  TemplateRef,
  ViewChild,
  ViewContainerRef,
  computed,
  effect,
  signal,
} from '@angular/core';
import { CommonModule, DatePipe, SlicePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import * as echarts from 'echarts';
import { GlassButtonComponent } from '../shared/components/glass-button.component';
import { GlassLoadingOverlayComponent } from '../shared/components/glass-loading-overlay.component';
import { GlassIconComponent } from '../shared/components/glass-icon.component';
import { XfcsApiService } from '../api/xfcs-api.service';
import { FileStatusItem, ReloadStatus } from '../api/xfcs-models';
import { ToastService } from '../shared/services/toast.service';

// ---------------------------------------------------------------------------
// Pure helper — exported so property tests can import it directly
// ---------------------------------------------------------------------------

export interface DailyTrendRow {
  day: string;
  done: number;
  failed: number;
  staging: number;
  pending: number;
}

export function buildDailyTrend(files: FileStatusItem[]): DailyTrendRow[] {
  const map = new Map<string, DailyTrendRow>();
  for (const f of files) {
    const day = f.createdAt ? f.createdAt.substring(0, 10) : 'unknown';
    if (!map.has(day)) map.set(day, { day, done: 0, failed: 0, staging: 0, pending: 0 });
    const row = map.get(day)!;
    if (f.fileStatus === 'completed') row.done++;
    else if (f.fileStatus === 'failed') row.failed++;
    else if (f.fileStatus === 'staging') row.staging++;
    else row.pending++;
  }
  return Array.from(map.values()).sort((a, b) => a.day.localeCompare(b.day));
}

/**
 * Strip the backend-appended display suffix from fileName.
 * Backend appends " [PRODUCTION]", " [SANDBOX]", or " [SANDBOX: reason...]" to fileName.
 * We show destination via its own column, so strip it here for clean display.
 */
export function stripDestinationSuffix(name: string | null | undefined): string {
  if (!name) return '';
  return name.replace(/\s*\[(?:PRODUCTION|SANDBOX)[^\]]*\]\s*$/, '').trim();
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

@Component({
  selector: 'app-xfcs-sessions',
  standalone: true,
  imports: [CommonModule, FormsModule, GlassButtonComponent, GlassLoadingOverlayComponent, GlassIconComponent, DatePipe, SlicePipe],
  template: `
    <div class="glass-panel p-6 animated fadeIn">

      <!-- Header -->
      <div class="header">
        <div class="title-group">
          <h2>My <span class="accent">Reload Sessions</span>
            <span class="active-badge" *ngIf="activeSessions() > 0" aria-label="{{ activeSessions() }} active sessions">
              {{ activeSessions() }}
            </span>
          </h2>
          <p class="subtitle">Track active and historical archival sessions with file-level details.</p>
        </div>
        <div class="actions">
          <app-glass-button variant="secondary" size="small" [loading]="loading()" (clicked)="loadSessions()">
            <app-glass-icon name="refresh" [size]="16"></app-glass-icon> Refresh
          </app-glass-button>
        </div>
      </div>

      <!-- Loading skeleton -->
      <ng-container *ngIf="loading()">
        <glass-loading-overlay
          [visible]="true"
          message="Loading sessions..."
          subtext="Fetching reload sessions and recent activity.">
        </glass-loading-overlay>
        <div class="skeleton-list">
          <div class="skeleton skeleton-row" *ngFor="let i of [1,2,3]"></div>
        </div>
      </ng-container>

      <!-- Empty state -->
      <div class="empty-state" *ngIf="sortedSessions().length === 0 && !loading()">
        <app-glass-icon name="inbox" [size]="48" color="muted"></app-glass-icon>
        <p>No reload sessions found.</p>
        <span class="empty-hint">Sessions will appear here once a reload is submitted.</span>
      </div>

      <!-- Sessions table -->
      <div class="table-wrap" *ngIf="!loading() && sortedSessions().length > 0">
        <table class="hub-table">
          <thead>
            <tr>
              <th class="w-12"></th>
              <th>Session ID</th>
              <th>Requester</th>
              <th>Environment</th>
              <th>Files</th>
              <th>Progress</th>
              <th>Status</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            <ng-container *ngFor="let s of sortedSessions()">
              <!-- Session row — click opens modal -->
              <tr (click)="selectSession(s)" class="session-row">
                <td>
                  <app-glass-icon name="open_in_new" [size]="16" color="muted"></app-glass-icon>
                </td>
                <td class="session-id-cell" (click)="$event.stopPropagation(); copySessionId(s.sessionId)" title="Click to copy full session ID">
                  <span class="mono font-semibold">{{ s.sessionId | slice:0:8 }}</span>
                  <span class="copied-tooltip" *ngIf="copiedId() === s.sessionId">Copied!</span>
                </td>
                <td>{{ s.requester || 'System' }}</td>
                <td><span class="env-badge">{{ s.environment || 'Unknown' }}</span></td>
                <td>{{ s.totalFiles }}</td>
                <td>
                  <div class="progress-cell">
                    <span class="pct">{{ calcProgress(s) }}%</span>
                    <div class="progress-bar">
                      <div class="progress-fill" [style.width.%]="calcProgress(s)" [class]="s.status.toLowerCase()"></div>
                    </div>
                  </div>
                </td>
                <td>
                  <span class="status-badge" [class]="s.status.toLowerCase()"
                        [attr.aria-label]="'Session status: ' + s.status">
                    {{ s.status }}
                  </span>
                </td>
                <td class="text-sm text-muted">{{ s.updatedAt | date:'short' }}</td>
              </tr>
            </ng-container>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ================================================================
         Session Detail Modal — rendered via body portal (see selectSession/closeDetail)
         ================================================================ -->
    <ng-template #modalTpl>
      <glass-loading-overlay
        [visible]="selectedSessionLoading()"
        message="Loading session details..."
        subtext="Fetching file status and analytics for the selected session.">
      </glass-loading-overlay>
      <div class="xfcs-detail-overlay" (click)="closeDetail()">
        <div class="xfcs-detail-modal" (click)="$event.stopPropagation()">

          <!-- Header -->
          <div class="xfcs-detail-head">
            <div class="xfcs-detail-head-left">
              <span class="xfcs-detail-title">Session Detail — <span class="mono">{{ selectedSession()?.sessionId | slice:0:8 }}</span></span>
              <span class="xfcs-status-badge" [class]="selectedSession()?.status?.toLowerCase()"
                    [attr.aria-label]="'Session status: ' + selectedSession()?.status">
                {{ selectedSession()?.status }}
              </span>
              <span class="text-sm text-muted">{{ selectedSession()?.updatedAt | date:'short' }}</span>
            </div>
            <div class="xfcs-detail-head-actions">
              <button class="xfcs-action-btn" (click)="copySessionId(selectedSession()!.sessionId)" title="Copy full session ID">
                <app-glass-icon name="content_copy" [size]="15"></app-glass-icon>
                <span *ngIf="copiedId() === selectedSession()?.sessionId">Copied!</span>
                <span *ngIf="copiedId() !== selectedSession()?.sessionId">Copy ID</span>
              </button>
              <button class="xfcs-action-btn" (click)="refreshSession()">
                <app-glass-icon name="refresh" [size]="15"></app-glass-icon> Refresh
              </button>
              <button class="xfcs-action-btn" (click)="exportCurrentSessionFiles()">
                <app-glass-icon name="download" [size]="15"></app-glass-icon> Export CSV
              </button>
              <button class="xfcs-action-btn danger" (click)="cancelSession()" *ngIf="selectedSession()?.status === 'processing' || selectedSession()?.status === 'created'">
                <app-glass-icon name="cancel" [size]="15"></app-glass-icon> Cancel
              </button>
              <button class="xfcs-action-btn close-btn" (click)="closeDetail()">
                <app-glass-icon name="close" [size]="15"></app-glass-icon> Close
              </button>
            </div>
          </div>

          <!-- Metrics bar -->
          <div class="xfcs-metrics-bar" *ngIf="selectedSession() as sess">
            <div class="xfcs-metric-pill">
              <span class="xfcs-metric-label">Total</span>
              <span class="xfcs-metric-value">{{ sess.totalFiles ?? 0 }}</span>
            </div>
            <div class="xfcs-metric-pill success">
              <span class="xfcs-metric-label">Completed</span>
              <span class="xfcs-metric-value">{{ sess.completedFiles ?? 0 }}</span>
            </div>
            <div class="xfcs-metric-pill danger">
              <span class="xfcs-metric-label">Failed</span>
              <span class="xfcs-metric-value">{{ sess.failedFiles ?? 0 }}</span>
            </div>
            <div class="xfcs-metric-pill" [class]="sess.status.toLowerCase()">
              <span class="xfcs-metric-label">Status</span>
              <span class="xfcs-metric-value">{{ sess.status }}</span>
            </div>
          </div>

          <!-- Scrollable body -->
          <div class="xfcs-modal-scroll-body">

            <!-- Charts section -->
            <div class="xfcs-charts-section">
              <button class="xfcs-charts-toggle" (click)="chartsExpanded.set(!chartsExpanded())">
                <span class="xfcs-toggle-chevron">{{ chartsExpanded() ? '▾' : '▸' }}</span>
                <span>Session Analytics</span>
              </button>
              <div class="xfcs-charts-panel" *ngIf="chartsExpanded()">
                <div class="xfcs-charts-head">
                  <div class="xfcs-charts-head-top">
                    <div>
                      <span class="xfcs-charts-title">File Processing Trend</span>
                      <span class="xfcs-charts-subtitle">Grouped by creation date</span>
                    </div>
                    <div class="xfcs-date-range-controls">
                      <label class="xfcs-date-label">From</label>
                      <input type="date" class="xfcs-date-input" [(ngModel)]="analyticsStartDateInput" />
                      <label class="xfcs-date-label">To</label>
                      <input type="date" class="xfcs-date-input" [(ngModel)]="analyticsEndDateInput" />
                      <button class="xfcs-preset-btn apply-btn" (click)="applyAnalyticsDateRange()">Apply</button>
                      <button class="xfcs-preset-btn" (click)="clearAnalyticsDateRange()">Clear</button>
                    </div>
                  </div>
                  <div class="xfcs-preset-row">
                    <button class="xfcs-preset-btn" (click)="applyQuickPreset('today')">Today</button>
                    <button class="xfcs-preset-btn" (click)="applyQuickPreset('7d')">Last 7d</button>
                    <button class="xfcs-preset-btn" (click)="applyQuickPreset('30d')">Last 30d</button>
                    <button class="xfcs-preset-btn" (click)="applyQuickPreset('90d')">Last 90d</button>
                    <button class="xfcs-preset-btn" (click)="applyQuickPreset('month')">This Month</button>
                    <button class="xfcs-preset-btn" (click)="applyQuickPreset('all')">All</button>
                  </div>
                  <div class="xfcs-status-summary" *ngIf="analyticsStatusSummary() as summary">
                    <span class="xfcs-summary-pill success">Completed {{ summary.completedPct }}%</span>
                    <span class="xfcs-summary-pill danger">Failed {{ summary.failedPct }}%</span>
                    <span class="xfcs-summary-pill muted">Cancelled {{ summary.cancelledPct }}%</span>
                    <span class="xfcs-summary-pill">Total {{ summary.total }}</span>
                  </div>
                </div>
                <div class="xfcs-no-data-msg" *ngIf="filteredFiles().length === 0">No data available for the selected date range.</div>
                <div class="xfcs-charts-grid" *ngIf="filteredFiles().length > 0">
                  <div class="xfcs-chart-card">
                    <div class="xfcs-chart-card-title">Daily Status Trend</div>
                    <div id="xfcs-trend-chart" class="xfcs-chart-container"></div>
                  </div>
                  <div class="xfcs-chart-card">
                    <div class="xfcs-chart-card-title">Status Distribution</div>
                    <div id="xfcs-status-chart" class="xfcs-chart-container"></div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Files card -->
            <div class="xfcs-files-card">
              <div class="xfcs-files-card-header">
                <span class="xfcs-files-card-title">Files Details ({{ filteredSortedFiles().length }}<span *ngIf="fileSearch()" class="xfcs-search-count"> of {{ selectedFiles().length }}</span>)</span>
                <div class="xfcs-files-card-actions">
                  <div class="xfcs-search-wrap">
                    <input class="xfcs-search-input" type="text" placeholder="Search lot, filename, status…" [ngModel]="fileSearch()" (ngModelChange)="fileSearch.set($event); filesPage.set(1)" aria-label="Search files" />
                    <button *ngIf="fileSearch()" class="xfcs-search-clear" (click)="fileSearch.set(''); filesPage.set(1)" aria-label="Clear search">✕</button>
                  </div>
                  <button class="xfcs-files-hide-btn" (click)="filesTableExpanded.set(!filesTableExpanded())">
                    {{ filesTableExpanded() ? 'Hide' : 'Show' }}
                  </button>
                </div>
              </div>
              <div class="xfcs-files-card-body" *ngIf="filesTableExpanded()">
                <div class="xfcs-no-data-msg" *ngIf="selectedFiles().length === 0">No file details available.</div>
                <div class="xfcs-no-data-msg" *ngIf="selectedFiles().length > 0 && filteredSortedFiles().length === 0">No files match your search.</div>
                <div class="xfcs-table-scroll" *ngIf="filteredSortedFiles().length > 0">
                  <table class="xfcs-hub-table">
                    <thead>
                      <tr>
                        <th class="xfcs-th-sort" (click)="sortBy('lot')" [class.active]="sortCol()==='lot'">
                          Lot <span class="xfcs-sort-icon">{{ sortCol()==='lot' ? (sortDir()==='asc' ? '▲' : '▼') : '⇅' }}</span>
                        </th>
                        <th class="xfcs-th-sort" (click)="sortBy('filename')" [class.active]="sortCol()==='filename'">
                          Filename <span class="xfcs-sort-icon">{{ sortCol()==='filename' ? (sortDir()==='asc' ? '▲' : '▼') : '⇅' }}</span>
                        </th>
                        <th class="xfcs-th-sort" (click)="sortBy('status')" [class.active]="sortCol()==='status'">
                          Status <span class="xfcs-sort-icon">{{ sortCol()==='status' ? (sortDir()==='asc' ? '▲' : '▼') : '⇅' }}</span>
                        </th>
                        <th class="xfcs-th-sort" (click)="sortBy('destination')" [class.active]="sortCol()==='destination'">
                          Destination <span class="xfcs-sort-icon">{{ sortCol()==='destination' ? (sortDir()==='asc' ? '▲' : '▼') : '⇅' }}</span>
                        </th>
                        <th class="xfcs-th-sort" (click)="sortBy('created')" [class.active]="sortCol()==='created'">
                          Created <span class="xfcs-sort-icon">{{ sortCol()==='created' ? (sortDir()==='asc' ? '▲' : '▼') : '⇅' }}</span>
                        </th>
                        <th class="xfcs-th-sort" (click)="sortBy('endtime')" [class.active]="sortCol()==='endtime'">
                          End Time <span class="xfcs-sort-icon">{{ sortCol()==='endtime' ? (sortDir()==='asc' ? '▲' : '▼') : '⇅' }}</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      <ng-container *ngFor="let f of paginatedFiles()">
                        <tr>
                          <td class="mono text-sm">{{ f.userLotId || '—' }}</td>
                          <td class="xfcs-file-name-cell mono text-sm" [title]="stripDestinationSuffix(f.fileName) || f.absPath">{{ stripDestinationSuffix(f.fileName) || f.absPath }}</td>
                          <td>
                            <span class="xfcs-file-status-badge" [class]="f.fileStatus" [attr.aria-label]="'File status: ' + f.fileStatus">{{ f.fileStatus }}</span>
                          </td>
                          <td>
                            <ng-container *ngIf="f.fileStatus === 'completed'">
                              <span *ngIf="f.processingDestination === 'PRODUCTION'" class="xfcs-dest-badge production">PRODUCTION</span>
                              <span *ngIf="f.processingDestination === 'SANDBOX'" class="xfcs-dest-badge sandbox">SANDBOX</span>
                              <span *ngIf="f.processingDestination == null" class="xfcs-dest-badge unknown">N/A</span>
                            </ng-container>
                            <span *ngIf="f.fileStatus !== 'completed'" class="text-muted text-sm">—</span>
                          </td>
                          <td class="text-sm text-muted">{{ f.createdAt | date:'M/d/yy, h:mm a' }}</td>
                          <td class="text-sm text-muted">{{ f.resolvedAt | date:'M/d/yy, h:mm a' }}</td>
                        </tr>
                        <tr *ngIf="f.fileStatus === 'failed' && f.errorReason" class="xfcs-error-row">
                          <td colspan="6" class="xfcs-error-reason">
                            <app-glass-icon name="error" [size]="13" color="error"></app-glass-icon>
                            {{ f.errorReason }}
                          </td>
                        </tr>
                      </ng-container>
                    </tbody>
                  </table>
                </div>
                <!-- Pagination -->
                <div class="xfcs-pagination" *ngIf="filesTotalPages() > 1">
                  <span class="xfcs-page-info">Page {{ filesPage() }} of {{ filesTotalPages() }} · {{ filteredSortedFiles().length }} files</span>
                  <div class="xfcs-page-controls">
                    <button class="xfcs-page-btn" [disabled]="filesPage() === 1" (click)="filesPage.set(filesPage() - 1)">‹ Prev</button>
                    <ng-container *ngFor="let p of pageNumbers()">
                      <button class="xfcs-page-btn xfcs-page-num-btn" [class.active]="p === filesPage()" (click)="filesPage.set(p)">{{ p }}</button>
                    </ng-container>
                    <button class="xfcs-page-btn" [disabled]="filesPage() === filesTotalPages()" (click)="filesPage.set(filesPage() + 1)">Next ›</button>
                  </div>
                </div>
              </div>
            </div>

          </div><!-- /xfcs-modal-scroll-body -->
        </div>
      </div>
    </ng-template>
  `,
  styles: [`
    .p-6 { padding: 2rem; }

    /* Header */
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 2rem; }
    .title-group h2 { margin: 0 0 0.35rem 0; font-size: 1.75rem; letter-spacing: -0.02em; font-weight: 700; display: flex; align-items: center; gap: 0.6rem; }
    .subtitle { margin: 0; color: var(--text-muted); font-size: 0.95rem; }
    .active-badge { display: inline-flex; align-items: center; justify-content: center; min-width: 1.5rem; height: 1.5rem; padding: 0 0.4rem; border-radius: 999px; font-size: 0.7rem; font-weight: 800; background: var(--accent-color); color: #fff; letter-spacing: 0; }

    /* Skeleton */
    .skeleton-list { display: flex; flex-direction: column; gap: 0.75rem; padding: 0.5rem 0; }
    .skeleton-row { height: 52px; border-radius: 10px; }
    .skeleton { background: linear-gradient(90deg, rgba(255,255,255,0.04) 25%, rgba(255,255,255,0.09) 50%, rgba(255,255,255,0.04) 75%); background-size: 200% 100%; animation: shimmer 1.4s infinite; }
    @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

    /* Empty state */
    .empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.75rem; padding: 4rem 2rem; text-align: center; color: var(--text-muted); }
    .empty-state p { margin: 0; font-size: 1.1rem; font-weight: 600; color: var(--text-main); }
    .empty-hint { font-size: 0.875rem; color: var(--text-muted); }

    /* Table */
    .table-wrap { overflow-x: auto; background: rgba(30, 24, 64, 0.45); border-radius: 12px; border: 1px solid rgba(167, 139, 250, 0.15); box-shadow: 0 8px 32px rgba(0,0,0,0.2); }
    :host-context(body.light-theme) .table-wrap { background: rgba(99, 102, 241, 0.05); border-color: rgba(99, 102, 241, 0.15); }
    .hub-table { width: 100%; border-collapse: collapse; text-align: left; min-width: 700px; }
    .hub-table th { padding: 1rem 1.25rem; color: var(--text-muted); font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; border-bottom: 1px solid rgba(167, 139, 250, 0.15); }
    .hub-table td { padding: 1.15rem 1.25rem; border-bottom: 1px solid rgba(255,255,255,0.03); font-size: 0.9rem; min-height: 52px; }
    .hub-table tbody tr { transition: all 0.2s ease; cursor: pointer; }
    .hub-table tbody tr:not(.error-row):hover { background: rgba(129, 140, 248, 0.1); }
    .session-row { cursor: pointer; }

    /* Session ID cell */
    .session-id-cell { position: relative; cursor: pointer; }
    .session-id-cell:hover .mono { text-decoration: underline; text-decoration-style: dotted; }
    .copied-tooltip { position: absolute; top: -1.8rem; left: 50%; transform: translateX(-50%); background: rgba(16,185,129,0.9); color: #fff; font-size: 0.65rem; font-weight: 700; padding: 0.2rem 0.5rem; border-radius: 6px; white-space: nowrap; pointer-events: none; animation: fadeIn 0.15s ease; }

    /* Badges */
    .destination-badge { display: inline-flex; padding: 0.1rem 0.45rem; border-radius: 999px; font-size: 0.62rem; font-weight: 800; letter-spacing: 0.05em; text-transform: uppercase; white-space: nowrap; flex-shrink: 0; }
    .destination-badge.production { color: #10b981; background: rgba(16,185,129,0.12); border: 1px solid rgba(16,185,129,0.25); }
    .destination-badge.sandbox    { color: #f59e0b; background: rgba(245,158,11,0.12); border: 1px solid rgba(245,158,11,0.25); }
    .destination-badge.unknown    { color: var(--text-muted); background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); }
    .file-status-badge { display: inline-flex; padding: 0.15rem 0.55rem; border-radius: 999px; font-size: 0.62rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; white-space: nowrap; flex-shrink: 0; }
    .file-status-badge.pending   { color: var(--text-muted); background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); }
    .file-status-badge.staging   { color: var(--accent-color); background: rgba(129,140,248,0.12); border: 1px solid rgba(129,140,248,0.25); }
    .file-status-badge.completed { color: #10b981; background: rgba(16,185,129,0.1); border: 1px solid rgba(16,185,129,0.2); }
    .file-status-badge.failed    { color: #ef4444; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.2); }
    .status-badge { display: inline-flex; padding: 0.25rem 0.75rem; border-radius: 999px; font-size: 0.65rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; border: 1px solid transparent; }
    .status-badge.completed { color: #10b981; background: rgba(16,185,129,0.1); border-color: rgba(16,185,129,0.2); }
    .status-badge.failed, .status-badge.partially_failed { color: #ef4444; background: rgba(239,68,68,0.1); border-color: rgba(239,68,68,0.2); }
    .status-badge.created, .status-badge.queued { color: var(--text-muted); background: rgba(255,255,255,0.05); border-color: rgba(255,255,255,0.1); }
    .status-badge.processing { color: var(--accent-color); background: rgba(129,140,248,0.1); border-color: rgba(129,140,248,0.2); }
    .status-badge.cancelled { color: var(--text-muted); background: rgba(255,255,255,0.04); border-color: rgba(255,255,255,0.08); }
    .env-badge { display: inline-flex; padding: 0.15rem 0.6rem; border-radius: 6px; font-size: 0.7rem; font-weight: 800; background: rgba(167,139,250,0.12); border: 1px solid rgba(167,139,250,0.25); color: var(--accent-color); text-transform: uppercase; letter-spacing: 0.02em; }

    /* Progress */
    .progress-cell { display: flex; align-items: center; gap: 1rem; min-width: 140px; }
    .pct { min-width: 4ch; font-weight: 700; font-size: 0.8125rem; text-align: right; color: var(--text-main); }
    .progress-bar { flex: 1; height: 6px; background: rgba(255,255,255,0.08); border-radius: 99px; overflow: hidden; }
    .progress-fill { height: 100%; border-radius: 99px; background: var(--accent-color); transition: width 0.8s cubic-bezier(0.4,0,0.2,1); }
    .progress-fill.completed { background: var(--success); box-shadow: 0 0 10px rgba(16,185,129,0.3); }
    .progress-fill.failed, .progress-fill.partially_failed { background: var(--error); }

    /* Misc */
    .mono { font-family: 'JetBrains Mono', monospace; }
    .font-semibold { font-weight: 600; color: var(--accent-color); font-size: 0.85rem; }
    .text-sm { font-size: 0.8125rem; }
    .text-muted { color: var(--text-muted); }

    /* ================================================================
       Modal overlay — styles are global (injected via body portal)
       See styles.scss for .xfcs-detail-overlay / .xfcs-detail-modal
       ================================================================ */
    .detail-overlay, .detail-modal, .detail-head, .detail-head-left,
    .detail-head-actions, .action-btn, .metrics-bar, .metric-pill,
    .metric-label, .metric-value, .modal-scroll-body, .charts-section,
    .charts-toggle, .charts-panel, .charts-head, .charts-head-top,
    .charts-title, .charts-subtitle, .date-range-controls, .date-label,
    .date-input, .preset-row, .preset-btn, .status-summary, .summary-pill,
    .no-data-msg, .charts-grid, .chart-card, .chart-card-title,
    .chart-container, .files-card, .files-card-header, .files-card-title,
    .files-hide-btn, .files-card-body, .file-name-cell, .error-row,
    .error-reason { /* moved to global styles.scss */ }

    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    .animated { animation-duration: 0.5s; animation-fill-mode: both; }
    .fadeIn { animation-name: fadeIn; }
  `]
})
export class XfcsSessionsComponent implements OnInit, AfterViewInit, OnDestroy {

  // ── Existing signals ──────────────────────────────────────────────────────
  sessions = signal<ReloadStatus[]>([]);
  loading = signal(false);
  fileStatusMap = signal<Record<string, FileStatusItem[]>>({});
  copiedId = signal<string | null>(null);
  selectedSessionLoading = signal(false);

  // Property 4: sorted by updatedAt descending
  sortedSessions = computed(() =>
    [...this.sessions()].sort((a, b) =>
      new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime()
    )
  );

  activeSessions = computed(() =>
    this.sessions().filter((s: ReloadStatus) => s.status === 'processing' || s.status === 'created').length
  );

  // ── Task 10.1: Modal signals ───────────────────────────────────────────────
  selectedSession = signal<ReloadStatus | null>(null);
  selectedFiles = signal<FileStatusItem[]>([]);
  chartsExpanded = signal(true);
  filesTableExpanded = signal(true);
  analyticsStartDate = signal<string | null>(null);
  analyticsEndDate = signal<string | null>(null);

  // Pagination + search + sort for files table
  filesPage = signal(1);
  filesPageSize = 20;
  fileSearch = signal('');
  sortCol = signal('created');
  sortDir = signal<'asc' | 'desc'>('asc');

  filteredSortedFiles = computed(() => {
    const q = this.fileSearch().trim().toLowerCase();
    let list = this.selectedFiles();
    if (q) {
      list = list.filter(f =>
        (f.userLotId ?? '').toLowerCase().includes(q) ||
        stripDestinationSuffix(f.fileName ?? f.absPath ?? '').toLowerCase().includes(q) ||
        f.fileStatus.toLowerCase().includes(q) ||
        (f.processingDestination ?? '').toLowerCase().includes(q)
      );
    }
    const col = this.sortCol();
    const dir = this.sortDir() === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      let av = '', bv = '';
      if (col === 'lot')         { av = a.userLotId ?? ''; bv = b.userLotId ?? ''; }
      else if (col === 'filename')    { av = stripDestinationSuffix(a.fileName) || a.absPath || ''; bv = stripDestinationSuffix(b.fileName) || b.absPath || ''; }
      else if (col === 'status')      { av = a.fileStatus; bv = b.fileStatus; }
      else if (col === 'destination') { av = a.processingDestination ?? ''; bv = b.processingDestination ?? ''; }
      else if (col === 'created')     { av = a.createdAt ?? ''; bv = b.createdAt ?? ''; }
      else if (col === 'endtime')     { av = a.resolvedAt ?? ''; bv = b.resolvedAt ?? ''; }
      return av < bv ? -dir : av > bv ? dir : 0;
    });
  });

  filesTotalPages = computed(() => Math.max(1, Math.ceil(this.filteredSortedFiles().length / this.filesPageSize)));
  paginatedFiles = computed(() => {
    const start = (this.filesPage() - 1) * this.filesPageSize;
    return this.filteredSortedFiles().slice(start, start + this.filesPageSize);
  });
  pageNumbers = computed(() => {
    const total = this.filesTotalPages();
    const cur = this.filesPage();
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    const pages: number[] = [];
    for (let p = Math.max(1, cur - 2); p <= Math.min(total, cur + 2); p++) pages.push(p);
    if (pages[0] > 1) pages.unshift(1);
    if (pages[pages.length - 1] < total) pages.push(total);
    return pages;
  });

  sortBy(col: string): void {
    if (this.sortCol() === col) {
      this.sortDir.set(this.sortDir() === 'asc' ? 'desc' : 'asc');
    } else {
      this.sortCol.set(col);
      this.sortDir.set('asc');
    }
    this.filesPage.set(1);
  }

  // Two-way bound to date inputs (ngModel), applied on button click
  analyticsStartDateInput = '';
  analyticsEndDateInput = '';

  // Filtered files for analytics
  filteredFiles = computed(() => {
    const files = this.selectedFiles();
    const start = this.analyticsStartDate();
    const end = this.analyticsEndDate();
    if (!start && !end) return files;
    return files.filter((f: FileStatusItem) => {
      if (!f.createdAt) return true;
      const d = f.createdAt.substring(0, 10);
      if (start && d < start) return false;
      if (end && d > end) return false;
      return true;
    });
  });

  analyticsStatusSummary = computed(() => {
    const files = this.filteredFiles();
    const total = files.length;
    if (total === 0) return { total: 0, completedPct: 0, failedPct: 0, cancelledPct: 0 };
    const completed = files.filter((f: FileStatusItem) => f.fileStatus === 'completed').length;
    const failed = files.filter((f: FileStatusItem) => f.fileStatus === 'failed').length;
    return {
      total,
      completedPct: Math.round((completed / total) * 100),
      failedPct: Math.round((failed / total) * 100),
      cancelledPct: 0,
    };
  });

  dailyStatusRows = computed(() => buildDailyTrend(this.filteredFiles()));

  // ── ECharts ViewChild refs ─────────────────────────────────────────────────
  @ViewChild('modalTpl') modalTpl!: TemplateRef<void>;

  private trendChart: echarts.ECharts | null = null;
  private statusChart: echarts.ECharts | null = null;
  private modalPortalRef: ReturnType<ViewContainerRef['createEmbeddedView']> | null = null;
  private modalHostEl: HTMLElement | null = null;

  constructor(
    private api: XfcsApiService,
    private toast: ToastService,
    private vcr: ViewContainerRef,
  ) {
    // Re-render charts whenever filteredFiles changes (while modal is open)
    effect(() => {
      const rows = this.dailyStatusRows();
      const summary = this.analyticsStatusSummary();
      if (this.selectedSession() !== null && rows !== undefined && summary !== undefined) {
        // Schedule chart update after Angular renders the *ngIf
        setTimeout(() => this.initCharts(), 80);
      }
    });
  }

  ngOnInit() {
    this.loadSessions();
  }

  ngAfterViewInit() {}

  ngOnDestroy() {
    this.destroyCharts();
    this.closeModalPortal();
  }

  // ── Session list methods ───────────────────────────────────────────────────

  loadSessions() {
    this.loading.set(true);
    this.api.getSessions().subscribe({
      next: (data: ReloadStatus[]) => {
        this.sessions.set(data);
        this.loading.set(false);
      },
      error: () => {
        this.toast.error('Failed to load sessions');
        this.loading.set(false);
      }
    });
  }

  // Property 6: destination summary counts
  destinationSummary(files: FileStatusItem[]): { total: number; production: number; sandbox: number; failed: number } {
    const completed = files.filter(f => f.fileStatus === 'completed');
    return {
      total: files.length,
      production: completed.filter(f => f.processingDestination === 'PRODUCTION').length,
      sandbox: completed.filter(f => f.processingDestination === 'SANDBOX').length,
      failed: files.filter(f => f.fileStatus === 'failed').length,
    };
  }

  // Property 7: copy session ID with transient tooltip
  async copySessionId(id: string): Promise<void> {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(id);
      } else {
        this.copyUsingExecCommandFallback(id);
      }
      this.copiedId.set(id);
      setTimeout(() => this.copiedId.set(null), 1500);
    } catch {
      this.toast.error('Unable to copy session ID. Please copy manually.');
    }
  }

  private copyUsingExecCommandFallback(text: string): void {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '0';
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);

    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);

    if (!ok) {
      throw new Error('Copy failed');
    }
  }

  calcProgress(s: ReloadStatus): number {
    if (!s.totalFiles) return 0;
    const done = (s.completedFiles || 0) + (s.failedFiles || 0);
    return Math.round((done / s.totalFiles) * 100);
  }

  // Expose module-level helper to template
  readonly stripDestinationSuffix = stripDestinationSuffix;

  // ── Task 10.1: Modal methods ───────────────────────────────────────────────

  selectSession(session: ReloadStatus): void {
    this.selectedSession.set(session);
    this.selectedSessionLoading.set(true);
    this.selectedFiles.set([]);
    this.analyticsStartDate.set(null);
    this.analyticsEndDate.set(null);
    this.analyticsStartDateInput = '';
    this.analyticsEndDateInput = '';
    this.chartsExpanded.set(true);
    this.filesTableExpanded.set(true);
    this.fileSearch.set('');
    this.sortCol.set('created');
    this.sortDir.set('asc');
    this.filesPage.set(1);
    this.loadFileStatus(session.sessionId);
    // Portal the modal to document.body to escape overflow:hidden/auto ancestors
    this.openModalPortal();
  }

  closeDetail(): void {
    this.selectedSession.set(null);
    this.selectedSessionLoading.set(false);
    this.destroyCharts();
    this.closeModalPortal();
  }

  private openModalPortal(): void {
    this.closeModalPortal();
    const hostEl = document.createElement('div');
    document.body.appendChild(hostEl);
    this.modalHostEl = hostEl;
    this.modalPortalRef = this.vcr.createEmbeddedView(this.modalTpl);
    this.modalPortalRef.rootNodes.forEach((node: Node) => hostEl.appendChild(node));
    this.modalPortalRef.detectChanges();
  }

  private closeModalPortal(): void {
    if (this.modalPortalRef) {
      this.modalPortalRef.destroy();
      this.modalPortalRef = null;
    }
    this.modalHostEl?.remove();
    this.modalHostEl = null;
  }

  refreshSession(): void {
    const sess = this.selectedSession();
    if (!sess) return;
    this.selectedSessionLoading.set(true);
    this.api.getReloadStatus(sess.sessionId).subscribe({
      next: (updated: ReloadStatus) => {
        this.selectedSession.set(updated);
        // Reload files
        this.selectedFiles.set([]);
        this.loadFileStatus(updated.sessionId);
        // Also refresh the sessions list
        this.loadSessions();
      },
      error: () => {
        this.selectedSessionLoading.set(false);
        this.toast.error('Failed to refresh session');
      }
    });
  }

  cancelSession(): void {
    const sess = this.selectedSession();
    if (!sess) return;
    this.api.cancelSession(sess.sessionId).subscribe({
      next: (updated: ReloadStatus) => {
        this.selectedSession.set(updated);
        this.sessions.update((list: ReloadStatus[]) => list.map((s: ReloadStatus) => s.sessionId === updated.sessionId ? updated : s));
        this.toast.success('Session cancelled');
      },
      error: () => this.toast.error('Failed to cancel session')
    });
  }

  exportCurrentSessionFiles(): void {
    const files = this.selectedFiles();
    const sess = this.selectedSession();
    if (!files.length || !sess) return;

    const header = 'Lot,Filename,Status,Destination,Created,EndTime';
    const rows = files.map((f: FileStatusItem) =>
      [
        f.userLotId ?? '',
        stripDestinationSuffix(f.fileName) || f.absPath || '',
        f.fileStatus,
        f.destinationFolder ?? f.processingDestination ?? '',
        f.createdAt ?? '',
        f.resolvedAt ?? '',
      ].map((v: string) => `"${String(v).replace(/"/g, '""')}"`).join(',')
    );
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `session-${sess.sessionId.slice(0, 8)}-files.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  applyAnalyticsDateRange(): void {
    this.analyticsStartDate.set(this.analyticsStartDateInput || null);
    this.analyticsEndDate.set(this.analyticsEndDateInput || null);
  }

  clearAnalyticsDateRange(): void {
    this.analyticsStartDate.set(null);
    this.analyticsEndDate.set(null);
    this.analyticsStartDateInput = '';
    this.analyticsEndDateInput = '';
  }

  applyQuickPreset(preset: string): void {
    const today = new Date();
    const fmt = (d: Date) => d.toISOString().substring(0, 10);
    const todayStr = fmt(today);

    switch (preset) {
      case 'today':
        this.analyticsStartDate.set(todayStr);
        this.analyticsEndDate.set(todayStr);
        this.analyticsStartDateInput = todayStr;
        this.analyticsEndDateInput = todayStr;
        break;
      case '7d': {
        const s = new Date(today); s.setDate(s.getDate() - 6);
        this.analyticsStartDate.set(fmt(s));
        this.analyticsEndDate.set(todayStr);
        this.analyticsStartDateInput = fmt(s);
        this.analyticsEndDateInput = todayStr;
        break;
      }
      case '30d': {
        const s = new Date(today); s.setDate(s.getDate() - 29);
        this.analyticsStartDate.set(fmt(s));
        this.analyticsEndDate.set(todayStr);
        this.analyticsStartDateInput = fmt(s);
        this.analyticsEndDateInput = todayStr;
        break;
      }
      case '90d': {
        const s = new Date(today); s.setDate(s.getDate() - 89);
        this.analyticsStartDate.set(fmt(s));
        this.analyticsEndDate.set(todayStr);
        this.analyticsStartDateInput = fmt(s);
        this.analyticsEndDateInput = todayStr;
        break;
      }
      case 'month': {
        const s = new Date(today.getFullYear(), today.getMonth(), 1);
        this.analyticsStartDate.set(fmt(s));
        this.analyticsEndDate.set(todayStr);
        this.analyticsStartDateInput = fmt(s);
        this.analyticsEndDateInput = todayStr;
        break;
      }
      case 'all':
      default:
        this.clearAnalyticsDateRange();
        break;
    }
  }

  // ── Task 10.3: ECharts ─────────────────────────────────────────────────────

  initCharts(): void {
    const rows = this.dailyStatusRows();
    const summary = this.analyticsStatusSummary();
    if (!rows.length) return;

    const trendEl = document.getElementById('xfcs-trend-chart');
    const statusEl = document.getElementById('xfcs-status-chart');

    // Elements may not be in DOM yet (inside *ngIf) — retry
    if (!trendEl || !statusEl) {
      setTimeout(() => this.initCharts(), 80);
      return;
    }

    // If the DOM element changed (e.g. *ngIf toggled), dispose the stale instance
    if (this.trendChart && this.trendChart.getDom() !== trendEl) {
      this.trendChart.dispose();
      this.trendChart = null;
    }
    if (this.statusChart && this.statusChart.getDom() !== statusEl) {
      this.statusChart.dispose();
      this.statusChart = null;
    }

    if (!this.trendChart) {
      this.trendChart = echarts.init(trendEl, null, { renderer: 'canvas' });
    }
    this.trendChart.setOption(this.buildTrendOption(rows), true);
    this.trendChart.resize();

    if (!this.statusChart) {
      this.statusChart = echarts.init(statusEl, null, { renderer: 'canvas' });
    }
    this.statusChart.setOption(this.buildStatusOption(summary), true);
    this.statusChart.resize();
  }

  destroyCharts(): void {
    this.trendChart?.dispose();
    this.trendChart = null;
    this.statusChart?.dispose();
    this.statusChart = null;
  }

  private buildTrendOption(rows: DailyTrendRow[]): echarts.EChartsOption {
    const days = rows.map(r => r.day);
    return {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { data: ['Done', 'Failed', 'Staging', 'Pending'], textStyle: { color: '#a0a0b0' }, bottom: 0 },
      grid: { left: '3%', right: '4%', bottom: '15%', top: '8%', containLabel: true },
      xAxis: { type: 'category', data: days, axisLabel: { color: '#a0a0b0', fontSize: 10 }, axisLine: { lineStyle: { color: '#333' } } },
      yAxis: { type: 'value', axisLabel: { color: '#a0a0b0', fontSize: 10 }, splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } } },
      series: [
        { name: 'Done',    type: 'bar', stack: 'total', data: rows.map(r => r.done),    itemStyle: { color: '#10b981' } },
        { name: 'Failed',  type: 'bar', stack: 'total', data: rows.map(r => r.failed),  itemStyle: { color: '#ef4444' } },
        { name: 'Staging', type: 'bar', stack: 'total', data: rows.map(r => r.staging), itemStyle: { color: '#818cf8' } },
        { name: 'Pending', type: 'bar', stack: 'total', data: rows.map(r => r.pending), itemStyle: { color: '#6b7280' } },
      ],
    };
  }

  private buildStatusOption(summary: { total: number; completedPct: number; failedPct: number; cancelledPct: number }): echarts.EChartsOption {
    const total = summary.total;
    const completed = Math.round((summary.completedPct / 100) * total);
    const failed = Math.round((summary.failedPct / 100) * total);
    const cancelled = Math.round((summary.cancelledPct / 100) * total);
    const enqueued = Math.max(0, total - completed - failed - cancelled);
    return {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
      legend: { orient: 'vertical', right: '5%', top: 'center', textStyle: { color: '#a0a0b0', fontSize: 11 } },
      series: [{
        type: 'pie',
        radius: ['55%', '75%'],
        center: ['40%', '50%'],
        avoidLabelOverlap: false,
        label: { show: false },
        emphasis: { label: { show: true, fontSize: 13, fontWeight: 'bold' } },
        data: [
          { value: completed, name: 'Completed', itemStyle: { color: '#10b981' } },
          { value: failed,    name: 'Failed',    itemStyle: { color: '#ef4444' } },
          { value: cancelled, name: 'Cancelled', itemStyle: { color: '#6b7280' } },
          { value: enqueued,  name: 'Enqueued',  itemStyle: { color: '#818cf8' } },
        ].filter(d => d.value > 0),
      }],
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private loadFileStatus(sessionId: string): void {
    this.api.getSessionFiles(sessionId).subscribe({
      next: (files: FileStatusItem[]) => {
        // destinationFolder is authoritative ("PRODUCTION" | "SANDBOX" | null) — use directly.
        // Fall back to scanning resolvedPath for older rows that pre-date the column.
        const mapped = files.map((f: FileStatusItem) => {
          let dest: 'PRODUCTION' | 'SANDBOX' | null = null;
          if (f.destinationFolder === 'PRODUCTION' || f.destinationFolder === 'SANDBOX') {
            dest = f.destinationFolder as 'PRODUCTION' | 'SANDBOX';
          } else if (f.resolvedPath) {
            const p = f.resolvedPath.toLowerCase();
            if (p.includes('/production/')) dest = 'PRODUCTION';
            else if (p.includes('/sandbox/')) dest = 'SANDBOX';
          }
          return { ...f, processingDestination: dest };
        });
        this.fileStatusMap.update((m: Record<string, FileStatusItem[]>) => ({ ...m, [sessionId]: mapped }));
        if (this.selectedSession()?.sessionId === sessionId) {
          this.selectedFiles.set(mapped);
          this.filesPage.set(1);
          // Default date range: no filter (show all files for charts)
          this.analyticsStartDate.set(null);
          this.analyticsEndDate.set(null);
          this.analyticsStartDateInput = '';
          this.analyticsEndDateInput = '';
          // Tick so the portal view re-renders with the new data
          setTimeout(() => this.appRef.tick(), 50);
        }
        this.selectedSessionLoading.set(false);
      },
      error: () => {
        this.selectedSessionLoading.set(false);
      }
    });
  }
}
