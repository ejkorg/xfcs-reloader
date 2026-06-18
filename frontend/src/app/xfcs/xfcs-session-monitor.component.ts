import { Component, Input, Output, EventEmitter, OnChanges, OnDestroy, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GlassIconComponent } from '../shared/components/glass-icon.component';
import { ReloadStatus } from '../api/xfcs-models';
import { XfcsApiService } from '../api/xfcs-api.service';
import { ToastService } from '../shared/services/toast.service';

@Component({
  standalone: true,
  selector: 'app-xfcs-session-monitor',
  imports: [CommonModule, GlassIconComponent],
  template: `
    <section class="monitor-panel glass-panel">
      <ng-container *ngIf="effectiveLoading; else monitorContent">
        <div class="monitor-loading" role="status" aria-live="polite" aria-label="Loading session monitor">
          <div class="monitor-spinner"></div>
          <div class="monitor-loading-text">Loading session monitor...</div>
        </div>
      </ng-container>

      <ng-template #monitorContent>
      <ng-container *ngIf="lastStatus; else emptyState">
        <div class="panel-header">
          <div class="panel-title">
            <app-glass-icon name="sensors" [size]="18" color="primary"></app-glass-icon>
            <span>Session Monitor</span>
            <!-- Live connection indicator -->
            <span class="live-dot" *ngIf="liveConnected" title="Live SSE connection active"></span>
          </div>
          <span class="session-chip" title="{{ lastStatus.sessionId }}">
            {{ lastStatus.sessionId | slice:0:12 }}…
          </span>
        </div>

        <!-- Status + progress -->
        <div class="status-row">
          <span class="status-label"
            [class.running]="isRunning"
            [class.done]="isDone"
            [class.failed]="isFailed"
            [class.cancelled]="isCancelled">
            <span class="status-dot"></span>
            {{ lastStatus.status }}
          </span>
          <span class="progress-pct">{{ progressPercent }}%</span>
        </div>

        <div class="progress-track">
          <div class="progress-fill"
            [style.width.%]="progressPercent"
            [class.shimmer]="isRunning"
            [class.failed-fill]="isFailed">
          </div>
        </div>

        <div class="file-counts">
          <span class="count-item">
            <app-glass-icon name="dashboard" [size]="14" color="muted"></app-glass-icon>
            Total: {{ lastStatus.totalFiles ?? 0 }}
          </span>
          <span class="count-item success-count">
            <app-glass-icon name="check_circle" [size]="14" color="success"></app-glass-icon>
            Done: {{ lastStatus.completedFiles ?? 0 }}
          </span>
          <span class="count-item error-count" *ngIf="(lastStatus.failedFiles ?? 0) > 0">
            <app-glass-icon name="error" [size]="14" color="error"></app-glass-icon>
            Failed: {{ lastStatus.failedFiles ?? 0 }}
          </span>
        </div>

        <div class="session-message" *ngIf="lastStatus.message">
          <app-glass-icon name="info" [size]="14" color="muted"></app-glass-icon>
          {{ lastStatus.message }}
        </div>

        <div class="session-meta" *ngIf="lastStatus.requester || lastStatus.createdAt">
          <span *ngIf="lastStatus.requester">
            <app-glass-icon name="people" [size]="13" color="muted"></app-glass-icon>
            {{ lastStatus.requester }}
          </span>
          <span *ngIf="lastStatus.createdAt">
            <app-glass-icon name="clock" [size]="13" color="muted"></app-glass-icon>
            {{ lastStatus.createdAt | date:'short' }}
          </span>
        </div>

        <!-- Cancel button — only shown for non-terminal, non-cancelled sessions -->
        <div class="cancel-row" *ngIf="canCancel">
          <button class="cancel-btn" (click)="onCancelClick()" [disabled]="cancelling">
            <app-glass-icon name="cancel" [size]="14" color="error"></app-glass-icon>
            {{ cancelling ? 'Cancelling…' : 'Cancel Session' }}
          </button>
        </div>

        <!-- Inline confirmation -->
        <div class="confirm-row" *ngIf="showConfirm">
          <span class="confirm-text">Cancel this session?</span>
          <button class="confirm-yes" (click)="confirmCancel()">Yes, cancel</button>
          <button class="confirm-no" (click)="showConfirm = false">No</button>
        </div>
      </ng-container>
      </ng-template>

      <!-- Empty state -->
      <ng-template #emptyState>
        <div class="empty-monitor">
          <div class="empty-icon-wrap">
            <app-glass-icon name="clock" [size]="40" color="muted"></app-glass-icon>
          </div>
          <h3>No active session</h3>
          <p>Create a reload session to see live progress here.</p>
        </div>
      </ng-template>
    </section>
  `,
  styles: [`
    .monitor-panel { padding: 1.25rem; }

    .monitor-loading {
      min-height: 220px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.75rem;
      text-align: center;
    }

    .monitor-spinner {
      width: 34px;
      height: 34px;
      border-radius: 50%;
      border: 3px solid color-mix(in srgb, var(--accent-color) 25%, transparent);
      border-top-color: var(--accent-color);
      animation: monitorSpin 0.8s linear infinite;
    }

    .monitor-loading-text {
      font-size: 0.85rem;
      color: var(--text-muted);
      font-weight: 600;
    }

    .panel-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1rem;
    }

    .panel-title {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-weight: 700;
      font-size: 0.9rem;
    }

    .live-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #10b981;
      box-shadow: 0 0 6px rgba(16, 185, 129, 0.7);
      animation: livePulse 1.6s ease infinite;
    }

    .session-chip {
      background: color-mix(in srgb, var(--accent-color) 12%, transparent);
      color: var(--accent-color);
      border: 1px solid color-mix(in srgb, var(--accent-color) 35%, transparent);
      border-radius: 999px;
      padding: 0.2rem 0.65rem;
      font-size: 0.72rem;
      font-weight: 600;
      font-family: ui-monospace, SFMono-Regular, monospace;
      max-width: 180px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .status-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.55rem;
    }

    .status-label {
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--text-muted);
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--text-muted);
    }

    .status-label.running { color: var(--accent-color); }
    .status-label.running .status-dot {
      background: var(--accent-color);
      animation: pulse 1.4s ease infinite;
    }

    .status-label.done { color: var(--success); }
    .status-label.done .status-dot { background: var(--success); }

    .status-label.failed { color: var(--error); }
    .status-label.failed .status-dot { background: var(--error); }

    .status-label.cancelled { color: var(--text-muted); }
    .status-label.cancelled .status-dot { background: var(--text-muted); }

    .progress-pct {
      font-size: 1.1rem;
      font-weight: 700;
      color: var(--accent-color);
    }

    .progress-track {
      height: 10px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--card-border) 70%, transparent);
      overflow: hidden;
      margin-bottom: 0.65rem;
    }

    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, var(--accent-color), #a78bfa);
      border-radius: 999px;
      transition: width 0.45s ease;
      position: relative;
      overflow: hidden;
    }

    .progress-fill.failed-fill {
      background: linear-gradient(90deg, #f59e0b, #ef4444);
    }

    .progress-fill.shimmer::after {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      background: linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent);
      animation: shimmer 2s infinite;
    }

    .file-counts {
      display: flex;
      gap: 1rem;
      flex-wrap: wrap;
      font-size: 0.8125rem;
      color: var(--text-muted);
    }

    .count-item {
      display: flex;
      align-items: center;
      gap: 0.3rem;
    }

    .count-item.success-count { color: var(--success); }
    .count-item.error-count   { color: var(--error); }

    .session-message {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      margin-top: 0.65rem;
      font-size: 0.8125rem;
      color: var(--text-muted);
      padding: 0.5rem 0.65rem;
      border-radius: 8px;
      background: color-mix(in srgb, var(--card-bg) 80%, transparent);
      border: 1px solid var(--card-border);
    }

    .session-meta {
      display: flex;
      gap: 1rem;
      margin-top: 0.65rem;
      font-size: 0.75rem;
      color: var(--text-muted);
    }

    .session-meta span {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
    }

    .cancel-row {
      margin-top: 1rem;
    }

    .cancel-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.4rem 0.9rem;
      border-radius: 8px;
      border: 1px solid rgba(239, 68, 68, 0.4);
      background: rgba(239, 68, 68, 0.08);
      color: var(--error);
      font-size: 0.8rem;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    }

    .cancel-btn:hover:not(:disabled) {
      background: rgba(239, 68, 68, 0.16);
    }

    .cancel-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .confirm-row {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-top: 0.75rem;
      padding: 0.6rem 0.75rem;
      border-radius: 8px;
      background: rgba(239, 68, 68, 0.06);
      border: 1px solid rgba(239, 68, 68, 0.2);
    }

    .confirm-text {
      font-size: 0.8125rem;
      color: var(--error);
      flex: 1;
    }

    .confirm-yes, .confirm-no {
      padding: 0.25rem 0.7rem;
      border-radius: 6px;
      font-size: 0.75rem;
      font-weight: 700;
      cursor: pointer;
      border: 1px solid transparent;
    }

    .confirm-yes {
      background: rgba(239, 68, 68, 0.15);
      color: var(--error);
      border-color: rgba(239, 68, 68, 0.3);
    }

    .confirm-yes:hover { background: rgba(239, 68, 68, 0.25); }

    .confirm-no {
      background: rgba(255, 255, 255, 0.05);
      color: var(--text-muted);
      border-color: rgba(255, 255, 255, 0.1);
    }

    .confirm-no:hover { background: rgba(255, 255, 255, 0.1); }

    /* Empty state */
    .empty-monitor {
      min-height: 220px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      gap: 0.5rem;
    }

    .empty-icon-wrap {
      width: 72px;
      height: 72px;
      border-radius: 50%;
      background: color-mix(in srgb, var(--card-border) 60%, transparent);
      display: grid;
      place-items: center;
      margin-bottom: 0.5rem;
    }

    .empty-monitor h3 { font-size: 1rem; margin: 0; }
    .empty-monitor p { color: var(--text-muted); font-size: 0.8125rem; margin: 0; }

    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50%       { opacity: 0.5; transform: scale(0.8); }
    }

    @keyframes livePulse {
      0%, 100% { opacity: 1; box-shadow: 0 0 6px rgba(16, 185, 129, 0.7); }
      50%       { opacity: 0.6; box-shadow: 0 0 12px rgba(16, 185, 129, 0.4); }
    }

    @keyframes shimmer {
      0%   { transform: translateX(-100%); }
      100% { transform: translateX(100%); }
    }

    @keyframes monitorSpin {
      to { transform: rotate(360deg); }
    }
  `]
})
export class XfcsSessionMonitorComponent implements OnChanges, OnDestroy {
  @Input() parentManaged = false;
  @Input() sessionId?: string;
  @Input() lastStatus?: ReloadStatus;
  @Input() liveConnected = false;
  @Input() loading = false;
  @Output() sessionCompleted = new EventEmitter<ReloadStatus>();

  showConfirm = false;
  cancelling = false;
  internalLoading = false;

  private pollHandle: ReturnType<typeof setInterval> | null = null;
  private terminalEmittedKey: string | null = null;

  constructor(private api: XfcsApiService, private toast: ToastService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (this.parentManaged && changes['lastStatus']) {
      const s = this.lastStatus;
      if (s) {
        this.handleStatusUpdate(s);
      }
    }

    if (changes['parentManaged'] || changes['sessionId']) {
      this.syncSessionSource();
    }
  }

  ngOnDestroy(): void {
    this.stopPolling();
  }

  get effectiveLoading(): boolean {
    return this.loading || this.internalLoading;
  }

  onCancelClick(): void {
    this.showConfirm = true;
  }

  confirmCancel(): void {
    if (!this.lastStatus?.sessionId) return;
    this.showConfirm = false;
    this.cancelling = true;

    this.api.cancelSession(this.lastStatus.sessionId).subscribe({
      next: () => {
        this.cancelling = false;
        this.toast.success('Session cancelled');
        const sid = this.lastStatus?.sessionId ?? this.sessionId;
        if (sid) {
          this.fetchStatus(sid, false);
        }
      },
      error: (err: any) => {
        this.cancelling = false;
        if (err?.status === 409) {
          this.toast.warning('Session is already in a terminal state');
        } else {
          this.toast.error('Failed to cancel session');
        }
      }
    });
  }

  get canCancel(): boolean {
    const s = (this.lastStatus?.status ?? '').toLowerCase();
    return s !== '' && !['completed', 'failed', 'partially_failed', 'cancelled'].includes(s);
  }

  get progressPercent(): number {
    const total = this.lastStatus?.totalFiles ?? 0;
    if (total <= 0) return 0;
    const done = (this.lastStatus!.completedFiles ?? 0) + (this.lastStatus!.failedFiles ?? 0);
    return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
  }

  get isRunning(): boolean {
    const s = (this.lastStatus?.status ?? '').toLowerCase();
    return s === 'running' || s === 'processing' || s === 'created';
  }

  get isDone(): boolean {
    return (this.lastStatus?.status ?? '').toLowerCase() === 'completed';
  }

  get isFailed(): boolean {
    const s = (this.lastStatus?.status ?? '').toLowerCase();
    return s === 'failed' || s === 'partially_failed';
  }

  get isCancelled(): boolean {
    return (this.lastStatus?.status ?? '').toLowerCase() === 'cancelled';
  }

  private syncSessionSource(): void {
    // Parent-driven mode (xfcs.component): parent passes lastStatus/loading/liveConnected.
    if (this.parentManaged) {
      this.internalLoading = false;
      this.stopPolling();
      return;
    }

    // Self-driven mode (xfcs-stepper): only sessionId is provided.
    const sid = (this.sessionId ?? '').trim();
    if (!sid) {
      this.internalLoading = false;
      this.stopPolling();
      return;
    }

    this.fetchStatus(sid, true);
    this.startPolling(sid);
  }

  private startPolling(sessionId: string): void {
    this.stopPolling();
    this.pollHandle = setInterval(() => {
      if (this.lastStatus && (this.isDone || this.isFailed || this.isCancelled)) {
        this.stopPolling();
        return;
      }
      this.fetchStatus(sessionId, false);
    }, 3000);
  }

  private stopPolling(): void {
    if (this.pollHandle) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
  }

  private fetchStatus(sessionId: string, showLoading: boolean): void {
    if (showLoading) {
      this.internalLoading = true;
    }
    this.api.getReloadStatus(sessionId).subscribe({
      next: (status: ReloadStatus) => {
        this.lastStatus = status;
        this.internalLoading = false;
        this.handleStatusUpdate(status);
      },
      error: () => {
        this.internalLoading = false;
      }
    });
  }

  private handleStatusUpdate(status: ReloadStatus): void {
    const state = (status?.status ?? '').toLowerCase();
    const isTerminal = ['completed', 'failed', 'partially_failed', 'cancelled'].includes(state);

    if (!isTerminal) {
      this.terminalEmittedKey = null;
      return;
    }

    const key = `${status.sessionId}:${state}`;
    if (this.terminalEmittedKey === key) {
      return;
    }

    this.terminalEmittedKey = key;
    this.showConfirm = false;
    this.stopPolling();
    this.sessionCompleted.emit(status);
  }
}
