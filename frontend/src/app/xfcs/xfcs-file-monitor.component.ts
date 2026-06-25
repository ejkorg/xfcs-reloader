import { Component, DestroyRef, Input, OnChanges, OnDestroy, OnInit, SimpleChanges, inject, signal } from '@angular/core';
import { CommonModule, DatePipe, SlicePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Params } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { interval, Subscription } from 'rxjs';
import { GlassButtonComponent } from '../shared/components/glass-button.component';
import { GlassIconComponent } from '../shared/components/glass-icon.component';
import { SseService } from '../api/sse.service';
import { XfcsApiService } from '../api/xfcs-api.service';
import { FileStatusItem, ReloadSessionEvent, ReloadStatus } from '../api/xfcs-models';
import { ToastService } from '../shared/services/toast.service';

@Component({
  selector: 'app-xfcs-file-monitor',
  standalone: true,
  imports: [CommonModule, FormsModule, GlassButtonComponent, GlassIconComponent, DatePipe, SlicePipe],
  template: `
    <div class="glass-panel p-6 animated fadeIn" [class.embedded-panel]="embedded">
      <div class="header" *ngIf="!embedded">
        <div class="title-group">
          <h2>File <span class="accent">Monitor</span></h2>
          <p class="subtitle">Track individual file status and events with pagination. Auto-refreshes every {{ autoRefreshMs / 1000 }}s.</p>
        </div>
        <div class="actions">
          <app-glass-button variant="secondary" size="small" (clicked)="onManualRefresh()">
            <app-glass-icon name="refresh" [size]="16"></app-glass-icon> Refresh
          </app-glass-button>
        </div>
      </div>

      <div class="embedded-title" *ngIf="embedded">
        <h3>Per-file Tracking</h3>
        <span class="embedded-subtitle">Unique files only · latest event/state per file</span>
        <app-glass-button variant="secondary" size="small" (clicked)="onManualRefresh()">
          <app-glass-icon name="refresh" [size]="16"></app-glass-icon> Refresh
        </app-glass-button>
      </div>

      <div class="filter-section" *ngIf="!embedded">
        <div class="filter-controls">
          <label>Session ID</label>
          <input 
            type="text" 
            placeholder="Enter session ID or leave empty for all" 
            [(ngModel)]="filterSessionId"
            (keyup.enter)="applyFilter()"
            class="filter-input">
          <app-glass-button size="small" (clicked)="applyFilter()">
            <app-glass-icon name="search" [size]="14"></app-glass-icon> Apply Filter
          </app-glass-button>
        </div>
      </div>

      <div class="table-wrap">
        <table class="hub-table">
          <thead>
          <tr>
            <th class="file-col">File</th>
            <th>Status</th>
            <th>Event</th>
            <th>Staged</th>
            <th>Finished</th>
            <th *ngIf="!embedded">Destination</th>
            <th *ngIf="!embedded">Error</th>
          </tr>
          </thead>
          <tbody>
          <ng-container *ngFor="let f of paginatedFiles()">
            <tr>
              <td class="mono file-cell">
                <span class="file-name" [title]="f.fileName || f.absPath">{{ f.fileName || f.absPath }}</span>
                <div class="file-meta-row">
                  <span class="env-badge" *ngIf="f.userLotId">{{ f.userLotId }}</span>
                  <span class="dest-badge" *ngIf="embedded && f.destinationFolder">{{ f.destinationFolder }}</span>
                </div>
                <div class="file-path" *ngIf="f.resolvedPath">{{ f.resolvedPath }}</div>
              </td>
              <td>
                <div class="status-cell">
                  <span class="file-status-badge" [class]="f.fileStatus">{{ statusBadgeLabel(f) }}</span>
                  <div class="status-detail" [class.error-text]="f.fileStatus === 'failed' || f.fileStatus === 'unverified-exensio'">{{ statusDetailText(f) }}</div>
                </div>
              </td>
              <td class="text-sm text-muted">{{ fileEventLabel(f) }}</td>
              <td class="text-sm text-muted">{{ f.createdAt | date:'short' }}</td>
              <td class="text-sm text-muted">{{ (f.resolvedAt | date:'short') ?? '—' }}</td>
              <td *ngIf="!embedded">
                <span class="dest-badge" *ngIf="f.destinationFolder">{{ f.destinationFolder }}</span>
              </td>
              <td class="text-sm error-cell" *ngIf="!embedded">
                <span class="error-text" *ngIf="f.errorReason" [title]="f.errorReason">{{ f.errorReason | slice:0:72 }}{{ (f.errorReason || '').length > 72 ? '…' : '' }}</span>
              </td>
            </tr>
          </ng-container>
          <tr *ngIf="paginatedFiles().length === 0 && !loading()">
            <td [attr.colspan]="embedded ? 5 : 7" class="empty-state">{{ loading() ? 'Loading files...' : 'No files found.' }}</td>
          </tr>
          </tbody>
        </table>
      </div>

      <div class="pagination-section" *ngIf="totalPages() > 1">
        <div class="pagination-info">
          <span>Page {{ currentPage() }} of {{ totalPages() }} | Total: {{ totalFiles() }} files</span>
        </div>
        <div class="pagination-controls">
          <app-glass-button 
            size="small" 
            [disabled]="currentPage() === 1"
            (clicked)="currentPage.set(currentPage() - 1)">
            <app-glass-icon name="navigate_before" [size]="16"></app-glass-icon>
          </app-glass-button>
          
          <span class="page-indicator">{{ currentPage() }}</span>
          
          <app-glass-button 
            size="small" 
            [disabled]="currentPage() === totalPages()"
            (clicked)="currentPage.set(currentPage() + 1)">
            <app-glass-icon name="navigate_next" [size]="16"></app-glass-icon>
          </app-glass-button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .p-6 { padding: 2rem; }
    .embedded-panel { padding: 1.25rem; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 2rem; }
    .embedded-title { display: grid; grid-template-columns: auto 1fr auto; gap: 0.75rem; align-items: center; margin-bottom: 1rem; }
    .embedded-title h3 { margin: 0; font-size: 1rem; letter-spacing: 0.01em; }
    .embedded-subtitle { font-size: 0.78rem; color: var(--text-muted); }
    .title-group h2 { margin: 0 0 0.35rem 0; font-size: 1.75rem; letter-spacing: -0.02em; font-weight: 700; }
    .subtitle { margin: 0; color: var(--text-muted); font-size: 0.95rem; }

    .filter-section {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(167, 139, 250, 0.15);
      border-radius: 12px;
      padding: 1.25rem;
      margin-bottom: 1.5rem;
    }
    .filter-controls {
      display: flex;
      gap: 1rem;
      align-items: flex-end;
    }
    .filter-controls label {
      color: var(--text-muted);
      font-size: 0.85rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .filter-input {
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(167, 139, 250, 0.2);
      border-radius: 8px;
      padding: 0.5rem 0.75rem;
      color: var(--text-main);
      font-size: 0.875rem;
      min-width: 300px;
    }
    .filter-input:focus {
      outline: none;
      border-color: rgba(167, 139, 250, 0.5);
      box-shadow: 0 0 8px rgba(167, 139, 250, 0.2);
    }

    .table-wrap { overflow-x: auto; background: rgba(30, 24, 64, 0.45); border-radius: 12px; border: 1px solid rgba(167, 139, 250, 0.15); box-shadow: 0 8px 32px rgba(0,0,0,0.2); margin-bottom: 1.5rem; }
    :host-context(body.light-theme) .table-wrap { background: rgba(99, 102, 241, 0.05); border-color: rgba(99, 102, 241, 0.15); }

    .hub-table { width: 100%; border-collapse: collapse; text-align: left; table-layout: fixed; }
    .hub-table th { padding: 1rem 1.25rem; color: var(--text-muted); font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; border-bottom: 1px solid rgba(167, 139, 250, 0.15); }
    .hub-table td { padding: 0.85rem 1.25rem; border-bottom: 1px solid rgba(255, 255, 255, 0.03); font-size: 0.9rem; }
    .hub-table tbody tr { transition: all 0.2s ease; }
    .hub-table tbody tr:hover { background: rgba(129, 140, 248, 0.1); }
    .file-col { width: 48%; }
    .file-cell { vertical-align: top; }
    .file-meta-row { margin-top: 0.35rem; display: flex; gap: 0.4rem; flex-wrap: wrap; }
    .file-path {
      margin-top: 0.35rem;
      font-size: 0.72rem;
      color: var(--text-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 64ch;
    }

    .file-name {
      color: var(--accent-color);
      font-weight: 600;
      display: inline-block;
      max-width: 64ch;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .mono { font-family: 'JetBrains Mono', monospace; }
    .text-sm { font-size: 0.8125rem; }
    .text-muted { color: var(--text-muted); }
    .status-cell { display: flex; flex-direction: column; gap: 0.25rem; }
    .status-detail { font-size: 0.72rem; color: var(--text-muted); line-height: 1.2; }
    .error-cell { color: var(--error); }
    .error-text { opacity: 0.85; }

    .file-status-badge { display: inline-flex; padding: 0.15rem 0.55rem; border-radius: 999px; font-size: 0.62rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; white-space: nowrap; }
    .file-status-badge.pending   { color: var(--text-muted); background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); }
    .file-status-badge.staging   { color: var(--accent-color); background: rgba(129,140,248,0.12); border: 1px solid rgba(129,140,248,0.25); }
    .file-status-badge.etl_complete { color: #f59e0b; background: rgba(245,158,11,0.12); border: 1px solid rgba(245,158,11,0.3); }
    .file-status-badge.completed { color: #10b981; background: rgba(16,185,129,0.1); border: 1px solid rgba(16,185,129,0.2); }
    .file-status-badge.unverified-exensio { color: #fb923c; background: rgba(251,146,60,0.1); border: 1px solid rgba(251,146,60,0.3); }
    .file-status-badge.failed    { color: #ef4444; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.2); }

    .env-badge { display: inline-flex; padding: 0.15rem 0.6rem; border-radius: 6px; font-size: 0.7rem; font-weight: 800; background: rgba(167, 139, 250, 0.12); border: 1px solid rgba(167, 139, 250, 0.25); color: var(--accent-color); text-transform: uppercase; letter-spacing: 0.02em; }
    .dest-badge {
      display: inline-flex;
      padding: 0.1rem 0.45rem;
      border-radius: 999px;
      font-size: 0.62rem;
      font-weight: 800;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: #34d399;
      background: rgba(16,185,129,0.12);
      border: 1px solid rgba(16,185,129,0.25);
      white-space: nowrap;
    }

    .empty-state { text-align: center; color: var(--text-muted); padding: 3rem !important; font-style: italic; }

    .pagination-section {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 1rem;
      background: rgba(255, 255, 255, 0.02);
      border-top: 1px solid rgba(167, 139, 250, 0.15);
      border-radius: 0 0 12px 12px;
    }
    .pagination-info { color: var(--text-muted); font-size: 0.875rem; font-weight: 500; }
    .pagination-controls { display: flex; align-items: center; gap: 0.75rem; }
    .page-indicator { color: var(--accent-color); font-weight: 700; min-width: 3ch; text-align: center; }

    @media (max-width: 960px) {
      .embedded-title { grid-template-columns: 1fr; }
      .file-col { width: 58%; }
      .hub-table th, .hub-table td { padding: 0.7rem 0.75rem; }
      .file-name, .file-path { max-width: 44ch; }
    }

    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    .animated { animation-duration: 0.5s; animation-fill-mode: both; }
    .fadeIn { animation-name: fadeIn; }
  `]
})
export class XfcsFileMonitorComponent implements OnInit, OnChanges {
  @Input() sessionId = '';
  @Input() embedded = false;
  @Input() autoRefresh = true;
  @Input() autoRefreshMs = 4000;

  files = signal<FileStatusItem[]>([]);
  loading = signal(false);
  currentPage = signal(1);
  pageSize = 25;
  filterSessionId = '';

  totalFiles = signal(0);

  private readonly destroyRef = inject(DestroyRef);
  private autoRefreshSub?: Subscription;
  private sseSub?: Subscription;
  private connectedSessionId: string | null = null;
  private refreshQueued = false;

  constructor(
    private api: XfcsApiService,
    private sse: SseService,
    private route: ActivatedRoute,
    private toast: ToastService
  ) {}

  ngOnInit() {
    if (!this.embedded && !this.sessionId) {
      this.route.queryParams.subscribe((params: Params) => {
        if (params['sessionId']) {
          this.filterSessionId = params['sessionId'];
          this.currentPage.set(1);
        }
      });
    }

    if (this.sessionId) {
      this.filterSessionId = this.sessionId;
    }

    this.loadFiles(false);
    this.setupRealtimeRefresh();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if ((changes['sessionId'] && !changes['sessionId'].firstChange) ||
        (changes['autoRefresh'] && !changes['autoRefresh'].firstChange) ||
        (changes['autoRefreshMs'] && !changes['autoRefreshMs'].firstChange)) {
      this.filterSessionId = this.sessionId || '';
      this.currentPage.set(1);
      this.loadFiles(false);
      this.setupRealtimeRefresh();
    }
  }

  ngOnDestroy(): void {
    this.stopRealtimeRefresh();
  }

  onManualRefresh(): void {
    this.requestRefresh(true);
  }

  applyFilter(): void {
    this.currentPage.set(1);
    this.requestRefresh(true);
    this.setupRealtimeRefresh();
  }

  private requestRefresh(showErrors = false): void {
    if (this.loading()) {
      this.refreshQueued = true;
      return;
    }
    this.loadFiles(showErrors);
  }

  loadFiles(showErrors = false) {
    this.loading.set(true);
    
    const targetSessionId = (this.sessionId || this.filterSessionId || '').trim();

    // If session ID is provided, load files for that session
    if (targetSessionId) {
      this.api.getSessionFiles(targetSessionId).subscribe({
        next: (data: FileStatusItem[]) => {
          const unique = this.normalizeUniqueFiles(data);
          this.files.set(unique);
          this.totalFiles.set(unique.length);
          this.ensurePageInRange();
          this.finishLoading();
        },
        error: () => {
          if (showErrors) {
            this.toast.error('Failed to load files for session');
          }
          this.finishLoading();
        }
      });
    } else {
      // Load all sessions and aggregate files
      this.api.getSessions().subscribe({
        next: (sessions: ReloadStatus[]) => {
          const allFiles: FileStatusItem[] = [];
          let completed = 0;
          const total = sessions.length;

          if (total === 0) {
            this.files.set([]);
            this.totalFiles.set(0);
            this.finishLoading();
            return;
          }

          sessions.forEach((session: ReloadStatus) => {
            this.api.getSessionFiles(session.sessionId).subscribe({
              next: (files: FileStatusItem[]) => {
                allFiles.push(...files);
                completed++;
                
                if (completed === total) {
                  const unique = this.normalizeUniqueFiles(allFiles);
                  this.files.set(unique);
                  this.totalFiles.set(unique.length);
                  this.ensurePageInRange();
                  this.finishLoading();
                }
              },
              error: () => {
                completed++;
                if (completed === total) {
                  const unique = this.normalizeUniqueFiles(allFiles);
                  this.files.set(unique);
                  this.totalFiles.set(unique.length);
                  this.ensurePageInRange();
                  this.finishLoading();
                }
              }
            });
          });
        },
        error: () => {
          if (showErrors) {
            this.toast.error('Failed to load sessions');
          }
          this.finishLoading();
        }
      });
    }
  }

  paginatedFiles() {
    const start = (this.currentPage() - 1) * this.pageSize;
    const end = start + this.pageSize;
    return this.files().slice(start, end);
  }

  totalPages() {
    return Math.ceil(this.totalFiles() / this.pageSize);
  }

  fileEventLabel(file: FileStatusItem): string {
    switch (file.fileStatus) {
      case 'completed':
        return file.resolvedAt ? 'Delivered' : 'Completed';
      case 'unverified-exensio':
        return 'Verify in Exensio';
      case 'failed':
        return file.errorReason ? 'Rejected / Error' : 'Failed';
      case 'etl_complete':
        return 'ETL Complete';
      case 'staging':
        return 'Staged';
      default:
        return 'Created';
    }
  }

  statusBadgeLabel(file: FileStatusItem): string {
    switch (file.fileStatus) {
      case 'staging':
        return 'staged';
      case 'pending':
        return 'created';
      case 'etl_complete': {
        const dest = (file.destinationFolder || '').toUpperCase();
        if (dest === 'PRODUCTION') return 'ETL → PROD';
        if (dest === 'SANDBOX')    return 'ETL → SANDBOX';
        return 'ETL done';
      }
      case 'unverified-exensio':
        return 'verify manually';
      default:
        return file.fileStatus;
    }
  }

  statusDetailText(file: FileStatusItem): string {
    if (file.fileStatus === 'pending') {
      return 'CREATED';
    }

    if (file.fileStatus === 'staging') {
      return 'STAGED';
    }

    if (file.fileStatus === 'etl_complete') {
      const destination = (file.destinationFolder || '').trim().toUpperCase();
      return destination ? `ETL COMPLETE - AWAITING EXENSIO (${destination})` : 'ETL COMPLETE - AWAITING EXENSIO';
    }

    if (file.fileStatus === 'unverified-exensio') {
      const destination = (file.destinationFolder || '').trim().toUpperCase();
      const dest = destination ? ` [${destination}]` : '';
      return `ETL COMPLETE${dest} - NOT VERIFIED IN EXENSIO - PLEASE VERIFY MANUALLY`;
    }

    if (file.fileStatus === 'completed') {
      const destination = (file.destinationFolder || '').trim().toUpperCase();
      const reason = (file.errorReason || '').trim();

      if (destination === 'PRODUCTION') {
        return 'COMPLETED - PRODUCTION';
      }

      if (destination === 'SANDBOX') {
        return reason ? `COMPLETED - SANDBOX [${reason}]` : 'COMPLETED - SANDBOX';
      }

      return 'COMPLETED';
    }

    const failReason = (file.errorReason || '').trim();
    return failReason ? `FAILED - [${failReason}]` : 'FAILED';
  }

  private ensurePageInRange(): void {
    const pages = Math.max(1, this.totalPages());
    if (this.currentPage() > pages) {
      this.currentPage.set(pages);
    }
    if (this.currentPage() < 1) {
      this.currentPage.set(1);
    }
  }

  private setupRealtimeRefresh(): void {
    this.stopRealtimeRefresh();

    if (!this.autoRefresh || this.autoRefreshMs < 1000) return;

    const targetSessionId = (this.sessionId || this.filterSessionId || '').trim();

    // Preferred modern approach: event-driven updates via SSE for a specific session.
    if (targetSessionId) {
      this.connectedSessionId = targetSessionId;
      this.sseSub = this.sse.connect(targetSessionId)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((event: ReloadSessionEvent) => {
          this.applyRealtimeEvent(event);
        });

      // Periodic reconciliation to guard against missed browser/network events.
      const reconcileEveryMs = Math.max(10000, this.autoRefreshMs * 3);
      this.autoRefreshSub = interval(reconcileEveryMs)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(() => this.requestRefresh(false));
      return;
    }

    // Fallback for global/all-sessions monitor: periodic refresh.
    this.autoRefreshSub = interval(this.autoRefreshMs)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.requestRefresh(false);
      });
  }

  private finishLoading(): void {
    this.loading.set(false);
    if (this.refreshQueued) {
      this.refreshQueued = false;
      this.requestRefresh(false);
    }
  }

  private stopRealtimeRefresh(): void {
    this.autoRefreshSub?.unsubscribe();
    this.autoRefreshSub = undefined;

    this.sseSub?.unsubscribe();
    this.sseSub = undefined;

    if (this.connectedSessionId) {
      this.sse.disconnect(this.connectedSessionId);
      this.connectedSessionId = null;
    }
  }

  private applyRealtimeEvent(event: ReloadSessionEvent): void {
    if (!event) return;

    const rawType = (event.eventType || '').trim();
    const type = rawType.toLowerCase();
    const message = event.message || '';

    // For broad session lifecycle changes, do a full refresh.
    if (type.startsWith('session_') || type === 'batch_staged') {
      this.requestRefresh(false);
      return;
    }

    const fileName = this.extractFileNameFromEventMessage(message);
    if (!fileName) return;

    const current = this.files();
    const idx = this.findByCanonicalName(current, fileName);
    const row: FileStatusItem = idx >= 0
      ? { ...current[idx] }
      : {
          absPath: fileName,
          fileName,
          originalFileName: fileName,
          fileStatus: 'pending',
          createdAt: event.eventTime
        };

    // Status progression from backend event stream.
    if (type === 'file_failed') {
      row.fileStatus = 'failed';
      const reason = this.extractReasonFromEventMessage(message);
      if (reason) row.errorReason = reason;
      row.resolvedAt = event.eventTime;
    } else if (type === 'file_unverified') {
      row.fileStatus = 'unverified-exensio';
      const reason = this.extractReasonFromEventMessage(message);
      if (reason) row.errorReason = reason;
      row.resolvedAt = event.eventTime;
      const destination = this.extractDestinationFromEventMessage(message);
      if (destination) row.destinationFolder = destination.toUpperCase();
    } else if (type === 'file_etl_completed') {
      // ETL moved file to Processed/ — awaiting Exensio confirmation
      if (this.statusRank(row.fileStatus) < this.statusRank('etl_complete')) {
        row.fileStatus = 'etl_complete';
      }
      const destination = this.extractDestinationFromEventMessage(message);
      if (destination) row.destinationFolder = destination.toUpperCase();
    } else if (type === 'file_completed') {
      // Distinguish staging-phase FILE_COMPLETED (uppercase in backend) from ETL terminal file_completed.
      if (rawType === 'FILE_COMPLETED') {
        if (this.statusRank(row.fileStatus) < this.statusRank('staging')) {
          row.fileStatus = 'staging';
        }
      } else {
        row.fileStatus = 'completed';
        row.resolvedAt = event.eventTime;
      }
    } else if (type === 'file_staging' || type === 'file_staged' || rawType === 'FILE_STAGED') {
      if (this.statusRank(row.fileStatus) < this.statusRank('staging')) {
        row.fileStatus = 'staging';
      }
    }

    const movedPath = this.extractResolvedPathFromEventMessage(message);
    if (movedPath) {
      row.resolvedPath = movedPath;
      row.destinationFolder = this.detectDestinationFolder(movedPath) || row.destinationFolder;
    }

    const destination = this.extractDestinationFromEventMessage(message);
    if (destination) {
      row.destinationFolder = destination.toUpperCase();
    }

    const lot = this.extractLotFromEventMessage(message);
    if (lot && !row.userLotId) {
      row.userLotId = lot;
    }

    const merged = idx >= 0
      ? [...current.slice(0, idx), row, ...current.slice(idx + 1)]
      : [row, ...current];

    const unique = this.normalizeUniqueFiles(merged);
    this.files.set(unique);
    this.totalFiles.set(unique.length);
    this.ensurePageInRange();
  }

  private findByCanonicalName(files: FileStatusItem[], fileName: string): number {
    const wanted = this.canonicalNameKey(fileName);
    if (!wanted) return -1;
    return files.findIndex((f: FileStatusItem) => this.canonicalFileKey(f) === wanted);
  }

  private extractFileNameFromEventMessage(message: string): string | null {
    if (!message) return null;

    const markerIdx = message.indexOf(': ');
    if (markerIdx >= 0 && markerIdx + 2 < message.length) {
      let value = message.substring(markerIdx + 2).trim();
      const lotIdx = value.indexOf(' (Lot:');
      if (lotIdx > 0) value = value.substring(0, lotIdx).trim();
      const reasonIdx = value.indexOf(' | Reason:');
      if (reasonIdx > 0) value = value.substring(0, reasonIdx).trim();
      const destIdx = value.indexOf(' | Destination:');
      if (destIdx > 0) value = value.substring(0, destIdx).trim();
      if (value) return value;
    }

    const moved = this.extractResolvedPathFromEventMessage(message);
    if (!moved) return null;
    const normalized = moved.replace(/\\/g, '/');
    const slash = normalized.lastIndexOf('/');
    return slash >= 0 ? normalized.substring(slash + 1) : normalized;
  }

  private extractReasonFromEventMessage(message: string): string | null {
    if (!message) return null;
    const token = ' | Reason:';
    const i = message.indexOf(token);
    if (i >= 0) {
      const val = message.substring(i + token.length).trim();
      return val || null;
    }
    const emDash = message.indexOf(' — ');
    if (emDash >= 0) {
      const val = message.substring(emDash + 3).trim();
      return val || null;
    }
    return null;
  }

  private extractDestinationFromEventMessage(message: string): string | null {
    if (!message) return null;
    const token = ' | Destination:';
    const i = message.indexOf(token);
    if (i < 0) return null;
    const val = message.substring(i + token.length).trim();
    return val || null;
  }

  private extractResolvedPathFromEventMessage(message: string): string | null {
    if (!message) return null;
    const token = 'File moved to:';
    const i = message.indexOf(token);
    if (i < 0) return null;
    const val = message.substring(i + token.length).trim();
    return val || null;
  }

  private extractLotFromEventMessage(message: string): string | null {
    if (!message) return null;
    const match = message.match(/\(Lot:\s*([^\)]+)\)/i);
    return match?.[1]?.trim() || null;
  }

  private detectDestinationFolder(text: string | null | undefined): string | undefined {
    if (!text) return undefined;
    const up = text.toUpperCase();
    if (up.includes('SANDBOX')) return 'SANDBOX';
    if (up.includes('PRODUCTION')) return 'PRODUCTION';
    return undefined;
  }

  private normalizeUniqueFiles(files: FileStatusItem[]): FileStatusItem[] {
    const deduped = new Map<string, FileStatusItem>();

    for (const file of files) {
      const key = this.canonicalFileKey(file);
      const existing = deduped.get(key);
      if (!existing) {
        deduped.set(key, { ...file });
        continue;
      }

      const merged = this.mergeByRecencyAndStatus(existing, file);
      deduped.set(key, merged);
    }

    return Array.from(deduped.values()).sort((a, b) => {
      const aTime = this.toEpoch(a.resolvedAt || a.createdAt);
      const bTime = this.toEpoch(b.resolvedAt || b.createdAt);
      return bTime - aTime;
    });
  }

  private mergeByRecencyAndStatus(a: FileStatusItem, b: FileStatusItem): FileStatusItem {
    const aTime = this.toEpoch(a.resolvedAt || a.createdAt);
    const bTime = this.toEpoch(b.resolvedAt || b.createdAt);
    const aRank = this.statusRank(a.fileStatus);
    const bRank = this.statusRank(b.fileStatus);

    let primary = a;
    let secondary = b;

    // Never regress status: prefer higher progression rank first.
    if (bRank > aRank) {
      primary = b;
      secondary = a;
    } else if (aRank > bRank) {
      primary = a;
      secondary = b;
    } else if (bTime > aTime) {
      primary = b;
      secondary = a;
    }

    return {
      ...secondary,
      ...primary,
      fileName: primary.fileName || secondary.fileName,
      originalFileName: primary.originalFileName || secondary.originalFileName,
      userLotId: primary.userLotId || secondary.userLotId,
      fileStatus: primary.fileStatus,
      errorReason: primary.errorReason || secondary.errorReason,
      resolvedPath: primary.resolvedPath || secondary.resolvedPath,
      destinationFolder: primary.destinationFolder || secondary.destinationFolder,
      createdAt: primary.createdAt || secondary.createdAt,
      resolvedAt: primary.resolvedAt || secondary.resolvedAt,
      absPath: primary.absPath || secondary.absPath
    };
  }

  private canonicalFileKey(file: FileStatusItem): string {
    const raw = (file.originalFileName || file.fileName || file.absPath || '').trim();
    return this.canonicalNameKey(raw);
  }

  private canonicalNameKey(name: string): string {
    const noDecorators = (name || '')
      .replace(/\s*\[[^\]]+\]\s*$/g, '')
      .replace(/^.*[\\/]/, '');

    return noDecorators
      .toLowerCase()
      .replace(/\.gz$/i, '')
      .replace(/_md5-[a-f0-9]{32}/i, '')
      .replace(/_[a-f0-9]{32}(?=\.)/i, '')
      .replace(/_reloaded_\d{8,}(?=\.)/i, '')
      .trim();
  }

  private statusRank(status: FileStatusItem['fileStatus']): number {
    switch (status) {
      case 'failed':
        return 5;
      case 'completed':
      case 'unverified-exensio':   // terminal — ETL done, Exensio unconfirmed
        return 4;
      case 'etl_complete':
        return 3;
      case 'staging':
        return 2;
      default:
        return 1;
    }
  }

  private toEpoch(value: string | Date | null | undefined): number {
    if (!value) return 0;
    const time = value instanceof Date ? value.getTime() : Date.parse(value);
    return Number.isNaN(time) ? 0 : time;
  }
}
