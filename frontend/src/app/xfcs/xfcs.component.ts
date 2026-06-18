import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { Subscription, firstValueFrom, catchError, of } from 'rxjs';
import { XfcsApiService } from '../api/xfcs-api.service';
import { SseService } from '../api/sse.service';
import { DashboardData, EnvYearRange, ReloadSessionEvent, ReloadStatus, SearchResult } from '../api/xfcs-models';
import { SearchResultsDialogComponent } from './search-results-dialog.component';
import { EnvInfoDialogComponent } from './env-info-dialog.component';
import { FindArchiveLotsDialogComponent } from './find-archive-lots-dialog.component';
import { XfcsHeroComponent, SearchRow } from './xfcs-hero.component';
import { XfcsStatsComponent } from './xfcs-stats.component';
import { XfcsSessionMonitorComponent } from './xfcs-session-monitor.component';
import { XfcsResultsTableComponent } from './xfcs-results-table.component';
import { XfcsSessionsComponent } from './xfcs-sessions.component';
import { ActivityFeedComponent, ActivityEvent } from '../shared/components/activity-feed.component';
import { ToastService } from '../shared/services/toast.service';

const SESSION_STORAGE_KEY = 'xfcs_current_session_id';

@Component({
  standalone: true,
  selector: 'app-xfcs',
  imports: [
    CommonModule,
    MatDialogModule,
    XfcsHeroComponent,
    XfcsStatsComponent,
    XfcsSessionMonitorComponent,
    XfcsResultsTableComponent,
    XfcsSessionsComponent,
    ActivityFeedComponent
  ],
  template: `
    <div class="xfcs-page">
      <!-- Hero command bar -->
      <app-xfcs-hero
        [envs]="envs"
        [environment]="environment"
        [lastStatus]="lastStatus"
        [hasResults]="results.length > 0"
        [selectedCount]="selectedResults.length"
        [downloading]="downloading"
        [searching]="searching"
        [currentSessionId]="currentSessionId"
        (environmentChange)="environment = $event"
        (search)="runSearch($event)"
        (createReload)="createReload()"
        (downloadFiles)="downloadFiles()"
        (openEnvInfo)="openEnvInfo()"
        (openFindLots)="openFindLots()"
        (refreshDashboard)="refreshDashboard()"
        (refreshSession)="refreshLastStatus()">
      </app-xfcs-hero>

      <!-- Stats row -->
      <app-xfcs-stats
        [dashboard]="dashboard"
        [lastStatus]="lastStatus">
      </app-xfcs-stats>

      <!-- Monitor + Activity feed side by side -->
      <div class="monitor-row">
        <app-xfcs-session-monitor
          [parentManaged]="true"
          [lastStatus]="lastStatus"
          [loading]="lastStatusLoading"
          [liveConnected]="liveConnected">
        </app-xfcs-session-monitor>

        <app-activity-feed [events]="activityEvents"></app-activity-feed>
      </div>

      <!-- Search results (conditional) -->
      <app-xfcs-results-table
        [results]="results"
        [selectedPaths]="selectedResultPaths"
        (selectionChanged)="onSelectionChanged($event)">
      </app-xfcs-results-table>

      <!-- Historical Sessions Table -->
      <app-xfcs-sessions></app-xfcs-sessions>
    </div>
  `,
  styles: [`
    .xfcs-page {
      display: grid;
      gap: 0.9rem;
      max-width: 1700px;
      margin: 0 auto;
    }

    .monitor-row {
      display: grid;
      grid-template-columns: 1.35fr 1fr;
      gap: 0.9rem;
      align-items: start;
    }

    @media (max-width: 1080px) {
      .monitor-row { grid-template-columns: 1fr; }
    }
  `]
})
export class XfcsComponent implements OnInit, OnDestroy {
  private static readonly MAX_ACTIVITY = 200;

  envs: EnvYearRange[] = [];
  environment = '';
  results: SearchResult[] = [];
  dashboard?: DashboardData;
  lastStatus?: ReloadStatus;
  currentSessionId = '';
  searching = false;
  downloading = false;
  lastStatusLoading = false;
  liveConnected = false;
  selectedResults: SearchResult[] = [];
  get selectedResultPaths(): string[] {
    return this.selectedResults
      .map((r: SearchResult): string => r.path)
      .filter((p: string): boolean => !!p && p.trim().length > 0);
  }

  activityEvents: ActivityEvent[] = [];
  private eventIdCounter = 0;
  private seenEventIds = new Set<number>();
  private sseSub?: Subscription;

  constructor(
    private api: XfcsApiService,
    private sse: SseService,
    private dialog: MatDialog,
    private toast: ToastService
  ) {}

  ngOnInit(): void {
    this.api.getEnvs().subscribe({
      next: (envs: EnvYearRange[]) => {
        this.envs = envs;
        if (!this.environment && envs.length) this.environment = envs[0].environment;
        this.addActivity(`Loaded ${envs.length} environment(s)`, 'check_circle', 'success', 'session');
        this.toast.success(`Loaded ${envs.length} environments`);
      },
      error: () => {
        this.addActivity('Failed to load environments', 'error', 'error', 'session');
        this.toast.error('Failed to load environments');
      }
    });
    this.refreshDashboard();

    // Restore session from localStorage
    const savedId = localStorage.getItem(SESSION_STORAGE_KEY);
    if (savedId) {
      this.currentSessionId = savedId;
      this.hydrateAndConnect(savedId);
    }
  }

  ngOnDestroy(): void {
    this.disconnectSse();
  }

  runSearch(rows: SearchRow[]): void {
    if (!rows || rows.length === 0) return;
    this.searching = true;
    this.results = [];

    const selectedEnv = this.envs.find(e => e.environment === this.environment);
    const site = selectedEnv?.siteName ?? '';
    const area = selectedEnv?.areaCode ?? '';
    const testerType = selectedEnv?.testerType ?? '';

    const requests = rows.map(row => {
      const lotIds = row.lotsRaw.split(/[\n,]/).map(x => x.trim()).filter(Boolean);
      const years = row.year ? [row.year] : undefined;
      const months = row.month ? [row.month] : undefined;

      return firstValueFrom(
        this.api.searchArchive({
          environment: this.environment,
          years,
          months,
          lotIds,
          site,
          area,
          testerType
        }).pipe(catchError(() => of([])))
      );
    });

    Promise.all(requests).then(resArrays => {
      this.searching = false;
      const allResults = resArrays.flat();

      const uniquePaths = new Set<string>();
      const finalResults: SearchResult[] = [];
      for (const r of allResults) {
        if (!uniquePaths.has(r.path)) {
          uniquePaths.add(r.path);
          finalResults.push(r);
        }
      }

      this.results = finalResults;
      this.selectedResults = [];
      this.addActivity(`Search returned ${finalResults.length} archive file(s)`, 'search', 'primary', 'file');

      const foundLots = Array.from(new Set(finalResults.map(x => x.lotId).filter(Boolean)));
      const allSearchedLots = new Set<string>();
      for (const row of rows) {
        row.lotsRaw.split(/[\n,]/).map(x => x.trim()).filter(Boolean).forEach(l => allSearchedLots.add(l));
      }
      const missingLots = Array.from(allSearchedLots).filter(id => !foundLots.includes(id));

      const ref = this.dialog.open(SearchResultsDialogComponent, {
        width: '700px',
        data: { total: finalResults.length, foundLots, missingLots }
      });
      ref.afterClosed().subscribe((keep: boolean) => {
        if (!keep) {
          this.results = [];
          this.selectedResults = [];
          this.addActivity('Cleared search results', 'close', 'muted', 'file');
        }
      });
    }).catch(() => {
      this.searching = false;
      this.addActivity('Archive search failed', 'error', 'error', 'file');
      this.toast.error('Archive search failed');
    });
  }

  openEnvInfo(): void {
    if (!this.environment) return;
    this.dialog.open(EnvInfoDialogComponent, { width: '760px', data: { environment: this.environment } });
  }

  openFindLots(): void {
    if (!this.environment) return;
    this.dialog.open(FindArchiveLotsDialogComponent, { width: '980px', data: { environment: this.environment } });
  }

  createReload(): void {
    const env = this.envs.find(e => e.environment === this.environment);
    if (!env) return;

    const targetFiles = this.getActionableFiles();
    if (targetFiles.length === 0) {
      this.toast.warning('No files available to reload');
      return;
    }

    const userSelected = this.selectedResults.length > 0;

    this.api.createReload({
      environment: env.environment,
      site: env.siteName || '',
      area: env.areaCode || '',
      testerType: env.testerType || '',
      filePaths: targetFiles.map(r => r.path)
    }).subscribe({
      next: (session: any) => {
        this.currentSessionId = session.id;
        localStorage.setItem(SESSION_STORAGE_KEY, session.id);
        this.seenEventIds.clear();
        this.addActivity(`Created reload session ${session.id.substring(0, 8)}…`, 'check_circle', 'success', 'session');
        this.toast.success(userSelected
          ? `Reload session created for ${targetFiles.length} selected file(s)`
          : `Reload session created for ${targetFiles.length} file(s)`);
        this.refreshLastStatus();
        this.connectSse(session.id);
      },
      error: () => {
        this.addActivity('Failed to create reload session', 'error', 'error', 'session');
        this.toast.error('Failed to create reload session');
      }
    });
  }

  onSelectionChanged(selected: SearchResult[]): void {
    this.selectedResults = selected ?? [];
  }

  async downloadFiles(): Promise<void> {
    const files = this.getActionableFiles();
    if (files.length === 0) {
      this.toast.warning('No files available to download');
      return;
    }

    const grouped = this.groupFilesForLotDownloads(files);
    const groups = Array.from(grouped.entries()).filter(([, rows]) => rows.length > 0);
    if (groups.length === 0) {
      this.toast.warning('No valid file paths available for download');
      return;
    }

    this.downloading = true;
    let downloadedGroups = 0;
    let downloadedFiles = 0;
    let hasAnyFailure = false;

    try {
      for (const [lotKey, rows] of groups) {
        const paths = rows
          .map((f: SearchResult): string => f.path)
          .filter((p: string): boolean => !!p && p.trim().length > 0);

        if (paths.length === 0) continue;

        try {
          const resp = await firstValueFrom(this.api.downloadFiles({ paths }));
          const blob = resp.body;
          if (!blob || blob.size === 0) {
            hasAnyFailure = true;
            continue;
          }

          const cd = resp.headers.get('content-disposition') ?? '';
          const serverFilename = this.extractFilename(cd);
          const filename = this.buildGroupedDownloadFilename(lotKey, serverFilename);
          const objectUrl = URL.createObjectURL(blob);
          try {
            const a = document.createElement('a');
            a.href = objectUrl;
            a.download = filename;
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
          } finally {
            URL.revokeObjectURL(objectUrl);
          }

          downloadedGroups += 1;
          downloadedFiles += paths.length;
          this.addActivity(`Downloaded ${paths.length} file(s) as ${filename}`, 'download', 'success', 'file');
        } catch {
          hasAnyFailure = true;
        }
      }

      if (downloadedGroups > 0) {
        this.toast.success(`Downloaded ${downloadedFiles} file(s) in ${downloadedGroups} archive(s)`);
      } else {
        this.addActivity('Failed to download searched files', 'error', 'error', 'file');
        this.toast.error('Failed to download files');
      }

      if (hasAnyFailure && downloadedGroups > 0) {
        this.toast.warning('Some lot groups failed to download');
      }
    } finally {
      this.downloading = false;
    }
  }

  private getActionableFiles(): SearchResult[] {
    if (this.selectedResults.length > 0) {
      return this.selectedResults;
    }
    return this.results;
  }

  private extractFilename(contentDisposition: string): string | null {
    if (!contentDisposition) return null;

    // RFC 5987 format: filename*=UTF-8''encoded-name.zip
    const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf8Match?.[1]) {
      try {
        return decodeURIComponent(utf8Match[1].trim().replace(/"/g, ''));
      } catch {
        return utf8Match[1].trim().replace(/"/g, '');
      }
    }

    // Basic format: filename="name.zip"
    const basicMatch = contentDisposition.match(/filename=([^;]+)/i);
    if (basicMatch?.[1]) {
      return basicMatch[1].trim().replace(/^"|"$/g, '');
    }
    return null;
  }

  private groupFilesForLotDownloads(files: SearchResult[]): Map<string, SearchResult[]> {
    const groups = new Map<string, SearchResult[]>();

    for (const f of files) {
      const lot = (f.userLotId ?? f.lotId ?? '').trim();
      const normalizedLot = lot.toUpperCase();
      const haystack = `${f.filename ?? ''} ${f.path ?? ''}`.toUpperCase();
      const hasLotInFilename = normalizedLot.length > 0 && haystack.includes(normalizedLot);
      const key = hasLotInFilename ? lot : 'MIXED';

      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(f);
    }

    return groups;
  }

  private buildGroupedDownloadFilename(lotKey: string, serverFilename?: string | null): string {
    const now = new Date();
    const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
    const safeLot = lotKey.replace(/[^a-zA-Z0-9._-]/g, '_');

    if (safeLot && safeLot !== 'MIXED') {
      return `xfcs-${safeLot}-${ts}.zip`;
    }

    if (serverFilename && serverFilename.toLowerCase().endsWith('.zip')) {
      return `xfcs-mixed-${ts}.zip`;
    }

    return `xfcs-mixed-${ts}.zip`;
  }

  refreshDashboard(): void {
    this.api.getDashboard().subscribe({
      next: (d: DashboardData) => { this.dashboard = d; },
      error: () => this.toast.warning('Dashboard refresh failed')
    });
  }

  refreshLastStatus(): void {
    if (!this.currentSessionId) return;
    this.lastStatusLoading = true;
    this.api.getReloadStatus(this.currentSessionId).subscribe({
      next: (s: ReloadStatus) => {
        this.lastStatus = s;
        this.lastStatusLoading = false;
        if (this.isTerminal(s.status)) {
          this.liveConnected = false;
        }
      },
      error: () => {
        this.lastStatusLoading = false;
        this.addActivity('Failed to load session status', 'warning', 'warning', 'session');
      }
    });
  }

  private hydrateAndConnect(sessionId: string): void {
    // Fetch full event log to hydrate activity feed
    this.api.getReloadEvents(sessionId).subscribe({
      next: (events: ReloadSessionEvent[]) => {
        for (const ev of events) {
          this.ingestEvent(ev);
        }
      },
      error: () => {}
    });

    // Fetch current status
    this.lastStatusLoading = true;
    this.api.getReloadStatus(sessionId).subscribe({
      next: (s: ReloadStatus) => {
        this.lastStatus = s;
        this.lastStatusLoading = false;
        // Only open SSE if session is still active
        if (!this.isTerminal(s.status)) {
          const lastId = this.seenEventIds.size > 0 ? Math.max(...Array.from(this.seenEventIds)) : undefined;
          this.connectSse(sessionId, lastId);
        }
      },
      error: () => {
        this.lastStatusLoading = false;
      }
    });
  }

  private connectSse(sessionId: string, lastEventId?: number): void {
    this.disconnectSse();
    this.liveConnected = true;

    this.sseSub = this.sse.connect(sessionId, lastEventId).subscribe({
      next: (ev: ReloadSessionEvent) => {
        this.ingestEvent(ev);
        // Re-fetch status on terminal events
        if (ev.eventType?.startsWith('SESSION_') || ev.eventType === 'COMPLETED' || ev.eventType === 'FAILED') {
          this.refreshLastStatus();
          this.refreshDashboard();
          if (this.isTerminal(this.lastStatus?.status)) {
            this.liveConnected = false;
          }
        }
      },
      error: () => {
        this.liveConnected = false;
      },
      complete: () => {
        this.liveConnected = false;
        this.refreshLastStatus();
        this.refreshDashboard();
      }
    });
  }

  private disconnectSse(): void {
    if (this.sseSub) {
      this.sseSub.unsubscribe();
      this.sseSub = undefined;
    }
    if (this.currentSessionId) {
      this.sse.disconnect(this.currentSessionId);
    }
    this.liveConnected = false;
  }

  private ingestEvent(ev: ReloadSessionEvent): void {
    if (ev.id != null && this.seenEventIds.has(ev.id)) return;
    if (ev.id != null) this.seenEventIds.add(ev.id);

    const msg = ev.message?.trim() || ev.eventType;
    const color = this.colorForEvent(ev);
    this.addActivity(msg, color === 'success' ? 'check_circle' : color === 'error' ? 'error' : 'info', color, 'session');
  }

  private colorForEvent(ev: ReloadSessionEvent): ActivityEvent['color'] {
    const t = (ev.eventType ?? '').toUpperCase();
    if (t.includes('FAILED') || ev.errorCode) return 'error';
    if (t.includes('COMPLETED') || t === 'SESSION_CREATED' || t === 'SESSION_STARTED') return 'success';
    return 'primary';
  }

  private isTerminal(status?: string): boolean {
    const s = (status ?? '').toLowerCase();
    return s === 'completed' || s === 'failed' || s === 'partially_failed' || s === 'cancelled';
  }

  private addActivity(
    message: string,
    icon: string,
    color: ActivityEvent['color'],
    type: ActivityEvent['type']
  ): void {
    const event: ActivityEvent = {
      id: `act-${++this.eventIdCounter}`,
      type,
      message,
      timestamp: new Date().toISOString(),
      icon,
      color
    };
    this.activityEvents = [event, ...this.activityEvents].slice(0, XfcsComponent.MAX_ACTIVITY);
  }
}
