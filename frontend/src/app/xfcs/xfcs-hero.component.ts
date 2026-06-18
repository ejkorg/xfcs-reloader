import { Component, Input, Output, EventEmitter, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GlassButtonComponent } from '../shared/components/glass-button.component';
import { GlassSelectComponent, GlassOption } from '../shared/components/glass-select.component';
import { GlassIconComponent } from '../shared/components/glass-icon.component';
import { EnvYearRange, ReloadStatus } from '../api/xfcs-models';

export interface SearchRow {
  id: number;
  year?: number;
  month?: number;
  lotsRaw: string;
}

@Component({
  standalone: true,
  selector: 'app-xfcs-hero',
  imports: [CommonModule, FormsModule, GlassButtonComponent, GlassSelectComponent, GlassIconComponent],
  template: `
    <section class="hero glass-panel">
      <div class="hero-head">
        <div class="hero-brand">
          <div class="eyebrow">XFCS Operations</div>
          <h2>Archive Reloader Command Center</h2>
          <p class="subtitle">
            Select an environment, enter lot IDs, search the archive, and dispatch a reload session.
          </p>
        </div>

        <div class="hero-badges">
          <span class="status-badge info">
            <app-glass-icon name="dashboard" [size]="14" color="primary"></app-glass-icon>
            {{ envs.length }} environments
          </span>
          <span class="status-badge"
            [class.success]="statusTone === 'success'"
            [class.warning]="statusTone === 'warning'"
            [class.info]="statusTone === 'info'">
            <app-glass-icon name="sensors" [size]="14"
              [color]="statusTone === 'success' ? 'success' : statusTone === 'warning' ? 'warning' : 'primary'">
            </app-glass-icon>
            {{ lastStatus?.status || 'Idle' }}
          </span>
        </div>
      </div>

      <div class="workspace-grid">
        <!-- Input panel -->
        <div class="input-panel">
          <div class="panel-title">
            <app-glass-icon name="search" [size]="18" color="primary"></app-glass-icon>
            <span>Reload Request</span>
          </div>
          <p class="panel-hint">Select environment and enter lot IDs to find dispatchable archive files.</p>

          <div class="fields">
            <div class="filter-grid">
              <app-glass-select
                label="Site"
                placeholder="Any Site"
                [options]="siteFilterOptions"
                [(ngModel)]="siteFilter"
                (ngModelChange)="onSiteFilterChange($event)">
              </app-glass-select>

              <app-glass-select
                label="Area"
                placeholder="Any Area"
                [options]="areaFilterOptions"
                [(ngModel)]="areaFilter"
                (ngModelChange)="onAreaFilterChange($event)">
              </app-glass-select>

              <app-glass-select
                label="Tester Type"
                placeholder="Any Tester Type"
                [options]="testerTypeFilterOptions"
                [(ngModel)]="testerTypeFilter"
                (ngModelChange)="onTesterTypeFilterChange($event)">
              </app-glass-select>
            </div>

            <app-glass-select
              label="Environment"
              placeholder="Select an environment"
              prefixIcon="dataset"
              [searchable]="true"
              [options]="envOptions"
              [(ngModel)]="environment"
              (ngModelChange)="onEnvironmentChange($event)">
            </app-glass-select>

            <div class="search-rows-container">
              <div class="search-row" *ngFor="let row of searchRows(); let i = index">
                <div class="row-header">
                  <span class="row-title">Criteria Block {{ i + 1 }}</span>
                  <button type="button" class="btn-remove" *ngIf="searchRows().length > 1" (click)="removeRow(row.id)">
                    <app-glass-icon name="close" [size]="14"></app-glass-icon>
                  </button>
                </div>
                <div class="row-pickers">
                  <app-glass-select
                    label="Year"
                    placeholder="Any Year"
                    [options]="yearOptions"
                    [ngModel]="row.year"
                    (ngModelChange)="updateRow(row.id, 'year', $event)">
                  </app-glass-select>
                  <app-glass-select
                    label="Month"
                    placeholder="Any Month"
                    [options]="monthOptions"
                    [ngModel]="row.month"
                    (ngModelChange)="updateRow(row.id, 'month', $event)">
                  </app-glass-select>
                </div>
                <div class="row-textarea">
                  <label class="floating-label">Lot IDs</label>
                  <textarea class="glass-textarea" placeholder="e.g. LOT123, LOT124&#10;(comma or newline separated)"
                    (input)="updateRow(row.id, 'lotsRaw', $any($event.target).value)"></textarea>
                </div>
              </div>
              
              <button type="button" class="btn-add-row" (click)="addRow()">
                <app-glass-icon name="add" [size]="16"></app-glass-icon>
                <span>Add Criteria Block</span>
              </button>
            </div>
          </div>

          <div class="action-row">
            <app-glass-button variant="primary" size="medium" [loading]="searching" (clicked)="search.emit(searchRows())">
              <app-glass-icon name="search" [size]="16" color="default"></app-glass-icon>
              Search Archive
            </app-glass-button>

            <app-glass-button variant="secondary" size="medium"
              [disabled]="!environment || !hasResults"
              (clicked)="createReload.emit()">
              <span class="material-icons" style="font-size:1rem">rocket_launch</span>
              Create Reload
            </app-glass-button>

            <app-glass-button variant="secondary" size="medium"
              [disabled]="!hasResults || downloading"
              [loading]="downloading"
              (clicked)="downloadFiles.emit()">
              <app-glass-icon name="download" [size]="16" color="default"></app-glass-icon>
              {{ selectedCount > 0 ? ('Download Selected (' + selectedCount + ')') : 'Download All Results' }}
            </app-glass-button>

            <app-glass-button variant="tertiary" size="medium"
              [disabled]="!environment"
              (clicked)="openEnvInfo.emit()">
              <app-glass-icon name="info" [size]="16" color="muted"></app-glass-icon>
              Env Info
            </app-glass-button>

            <app-glass-button variant="tertiary" size="medium"
              [disabled]="!environment"
              (clicked)="openFindLots.emit()">
              <span class="material-icons" style="font-size:1rem">manage_search</span>
              Find Lots
            </app-glass-button>
          </div>
        </div>

        <!-- Workflow panel -->
        <div class="flow-panel">
          <div class="panel-title">
            <app-glass-icon name="arrow_forward" [size]="18" color="primary"></app-glass-icon>
            <span>Execution Flow</span>
          </div>

          <div class="flow-steps">
            <div class="flow-step" [class.active]="stepActive(1)">
              <div class="step-num">1</div>
              <div class="step-body">
                <div class="step-title">Search archive files</div>
                <div class="step-hint">Find archive files by environment and lot IDs.</div>
              </div>
            </div>
            <div class="step-connector"></div>
            <div class="flow-step" [class.active]="stepActive(2)">
              <div class="step-num">2</div>
              <div class="step-body">
                <div class="step-title">Create reload session</div>
                <div class="step-hint">Dispatch selected files to a new reload session.</div>
              </div>
            </div>
            <div class="step-connector"></div>
            <div class="flow-step" [class.active]="stepActive(3)">
              <div class="step-num">3</div>
              <div class="step-body">
                <div class="step-title">Monitor live progress</div>
                <div class="step-hint">Track status, completion rate, and event log.</div>
              </div>
            </div>
          </div>

          <div class="quick-actions">
            <app-glass-button variant="secondary" size="small" (clicked)="refreshDashboard.emit()">
              <app-glass-icon name="refresh" [size]="14" color="default"></app-glass-icon>
              Refresh Dashboard
            </app-glass-button>
            <app-glass-button variant="secondary" size="small"
              [disabled]="!currentSessionId"
              (clicked)="refreshSession.emit()">
              <span class="material-icons" style="font-size:0.875rem">sync</span>
              Refresh Session
            </app-glass-button>
          </div>
        </div>
      </div>
    </section>
  `,
  styles: [`
    .hero { padding: 1.5rem; }

    .hero-head {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 1rem;
      margin-bottom: 1.25rem;
      flex-wrap: wrap;
    }

    .eyebrow {
      font-size: 0.7rem;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--accent-color);
      margin-bottom: 0.35rem;
    }

    h2 {
      font-size: 1.55rem;
      margin: 0 0 0.35rem;
      letter-spacing: -0.02em;
    }

    .subtitle {
      color: var(--text-muted);
      font-size: 0.875rem;
      margin: 0;
      max-width: 65ch;
    }

    .hero-badges {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-shrink: 0;
      flex-wrap: wrap;
    }

    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.3rem 0.7rem;
      border-radius: 999px;
      font-size: 0.75rem;
      font-weight: 600;
      border: 1px solid var(--card-border);
      background: var(--card-bg);
      color: var(--text-muted);
    }

    .status-badge.info { color: var(--accent-color); border-color: color-mix(in srgb, var(--accent-color) 35%, transparent); background: color-mix(in srgb, var(--accent-color) 10%, transparent); }
    .status-badge.success { color: var(--success); border-color: color-mix(in srgb, var(--success) 35%, transparent); background: color-mix(in srgb, var(--success) 10%, transparent); }
    .status-badge.warning { color: var(--error); border-color: color-mix(in srgb, var(--error) 35%, transparent); background: color-mix(in srgb, var(--error) 10%, transparent); }

    .workspace-grid {
      display: grid;
      grid-template-columns: 1.6fr 1fr;
      gap: 1rem;
    }

    .input-panel,
    .flow-panel {
      border: 1px solid var(--card-border);
      border-radius: 16px;
      padding: 1.1rem;
      background: color-mix(in srgb, var(--card-bg) 94%, transparent);
    }

    .panel-title {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.9rem;
      font-weight: 700;
      margin-bottom: 0.3rem;
    }

    .panel-hint {
      color: var(--text-muted);
      font-size: 0.8125rem;
      margin: 0 0 1rem;
    }

    .fields { display: flex; flex-direction: column; gap: 1rem; }
    
    .search-rows-container { display: flex; flex-direction: column; gap: 0.75rem; }

    .filter-grid {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 0.75rem;
    }

    @media (max-width: 900px) {
      .filter-grid { grid-template-columns: 1fr; }
    }
    
    .search-row {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      padding: 0.75rem;
      border-radius: 12px;
      border: 1px solid rgba(167, 139, 250, 0.2);
      background: rgba(30, 24, 64, 0.45);
    }
    
    :host-context(body.light-theme) .search-row {
      background: rgba(99, 102, 241, 0.05);
      border-color: rgba(99, 102, 241, 0.15);
    }
    
    .row-header { display: flex; justify-content: space-between; align-items: center; }
    .row-title { font-size: 0.75rem; font-weight: 700; color: var(--accent-color); text-transform: uppercase; letter-spacing: 0.05em; }
    
    .btn-remove { 
      background: transparent; border: none; color: var(--text-muted); padding: 0.2rem; cursor: pointer; border-radius: 50%; display: flex; align-items: center; justify-content: center; transition: all 0.2s;
    }
    .btn-remove:hover { background: rgba(239, 68, 68, 0.15); color: #ef4444; }
    
    .row-pickers { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; }
    
    .row-textarea { display: flex; flex-direction: column; gap: 0.25rem; }
    
    .floating-label { font-size: 0.6875rem; font-weight: 600; color: var(--text-muted); letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 2px; }
    
    .glass-textarea {
      width: 100%;
      min-height: 70px;
      padding: 0.75rem 1rem;
      border-radius: 14px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      background: rgba(255, 255, 255, 0.03);
      color: #fff;
      font-size: 0.9375rem;
      font-family: inherit;
      resize: vertical;
      transition: all 0.3s ease;
      backdrop-filter: blur(16px);
      box-sizing: border-box;
    }
    
    .glass-textarea:focus { border-color: var(--accent-color); box-shadow: 0 0 20px rgba(129, 140, 248, 0.15); outline: none; }
    
    :host-context(body.light-theme) .glass-textarea { background: rgba(255, 255, 255, 0.9); border-color: rgba(0, 0, 0, 0.15); color: var(--text-main); }
    :host-context(body.light-theme) .glass-textarea:focus { border-color: var(--accent-color); box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.1); }
    
    .btn-add-row {
      display: flex; align-items: center; justify-content: center; gap: 0.5rem; padding: 0.5rem; border-radius: 10px; border: 1px dashed rgba(167, 139, 250, 0.3); background: transparent; color: var(--text-muted); font-size: 0.8rem; font-weight: 600; cursor: pointer; transition: all 0.2s;
    }
    .btn-add-row:hover { border-color: var(--accent-color); color: var(--accent-color); background: rgba(129, 140, 248, 0.05); }

    .action-row {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
      margin-top: 0.8rem;
    }

    .flow-steps {
      display: flex;
      flex-direction: column;
      gap: 0;
      margin-top: 0.75rem;
    }

    .flow-step {
      display: flex;
      gap: 0.75rem;
      align-items: flex-start;
      padding: 0.65rem 0.75rem;
      border-radius: 12px;
      border: 1px solid var(--card-border);
      background: color-mix(in srgb, var(--card-bg) 80%, transparent);
      transition: border-color 0.2s ease, background 0.2s ease;
    }

    .flow-step.active {
      border-color: color-mix(in srgb, var(--accent-color) 42%, transparent);
      background: color-mix(in srgb, var(--accent-color) 8%, transparent);
    }

    .step-connector {
      width: 2px;
      height: 0.6rem;
      background: var(--card-border);
      margin-left: 1.35rem;
    }

    .step-num {
      width: 1.4rem;
      height: 1.4rem;
      border-radius: 50%;
      display: grid;
      place-items: center;
      font-size: 0.72rem;
      font-weight: 700;
      color: var(--accent-color);
      border: 1px solid color-mix(in srgb, var(--accent-color) 45%, transparent);
      background: color-mix(in srgb, var(--accent-color) 14%, transparent);
      flex-shrink: 0;
    }

    .step-title { font-size: 0.875rem; font-weight: 600; }
    .step-hint { font-size: 0.775rem; color: var(--text-muted); margin-top: 0.1rem; }

    .quick-actions {
      display: flex;
      gap: 0.5rem;
      margin-top: 0.9rem;
      flex-wrap: wrap;
    }

    @media (max-width: 1120px) {
      .workspace-grid { grid-template-columns: 1fr; }
      .hero-head { flex-direction: column; }
    }

    @media (max-width: 600px) {
      .action-row { flex-direction: column; }
    }
  `]
})
export class XfcsHeroComponent {
  @Input() envs: EnvYearRange[] = [];
  @Input() environment = '';
  @Input() lastStatus?: ReloadStatus;
  @Input() hasResults = false;
  @Input() selectedCount = 0;
  @Input() downloading = false;
  @Input() searching = false;
  @Input() currentSessionId = '';

  @Output() environmentChange = new EventEmitter<string>();
  @Output() search = new EventEmitter<SearchRow[]>();
  @Output() createReload = new EventEmitter<void>();
  @Output() downloadFiles = new EventEmitter<void>();
  @Output() openEnvInfo = new EventEmitter<void>();
  @Output() openFindLots = new EventEmitter<void>();
  @Output() refreshDashboard = new EventEmitter<void>();
  @Output() refreshSession = new EventEmitter<void>();

  searchRows = signal<SearchRow[]>([{ id: 1, lotsRaw: '' }]);
  private rowIdCounter = 1;

  // UI filters used to narrow the environment dropdown choices.
  // These are derived from backend-parsed environment naming (see EnvConfigService).
  siteFilter = '';
  areaFilter = '';
  testerTypeFilter = '';

  get envOptions(): GlassOption[] {
    const opts: GlassOption[] = [];

    const filteredEnvs = this.envs.filter(e => this.envMatchesFilters(e));

    const standardEnvs = filteredEnvs.filter(e => e.dbCode !== 'edbfound');
    const foundryEnvs = filteredEnvs.filter(e => e.dbCode === 'edbfound');

    if (standardEnvs.length > 0) {
      opts.push({ value: null, label: 'STANDARD PLANTS', isGroupHeader: true, indentLevel: 0 });
      const sites = Array.from(new Set(standardEnvs.map(e => e.siteName || 'Unknown')));
      for (const s of sites) {
        opts.push({ value: null, label: s, isGroupHeader: true, indentLevel: 1 });
        const siteEnvs = standardEnvs.filter(e => (e.siteName || 'Unknown') === s);
        
        const procs = Array.from(new Set(siteEnvs.map(e => e.processGroup || 'OTHERS')));
        for (const p of procs) {
          opts.push({ value: null, label: p, isGroupHeader: true, indentLevel: 2 });
          const leaves = siteEnvs.filter(e => (e.processGroup || 'OTHERS') === p);
          for (const leaf of leaves) {
            opts.push({ 
              value: leaf.environment, 
              label: leaf.environment, 
              indentLevel: 3,
              searchKeywords: `${s} ${p}`
            });
          }
        }
      }
    }

    if (foundryEnvs.length > 0) {
      opts.push({ value: null, label: 'FOUNDRY (edbfound)', isGroupHeader: true, indentLevel: 0 });
      const parents = Array.from(new Set(foundryEnvs.map(e => e.parentGroup || 'Unknown')));
      for (const p of parents) {
        opts.push({ value: null, label: p, isGroupHeader: true, indentLevel: 1 });
        const parentEnvs = foundryEnvs.filter(e => (e.parentGroup || 'Unknown') === p);

        const regions = Array.from(new Set(parentEnvs.map(e => e.regionGroup || 'Unknown')));
        for (const r of regions) {
          opts.push({ value: null, label: r, isGroupHeader: true, indentLevel: 2 });
          const regionEnvs = parentEnvs.filter(e => (e.regionGroup || 'Unknown') === r);

          const procs = Array.from(new Set(regionEnvs.map(e => e.processGroup || 'OTHERS')));
          for (const pr of procs) {
            opts.push({ value: null, label: pr, isGroupHeader: true, indentLevel: 3 });
            const leaves = regionEnvs.filter(e => (e.processGroup || 'OTHERS') === pr);
            for (const leaf of leaves) {
              opts.push({ 
                 value: leaf.environment, 
                 label: leaf.environment, 
                 indentLevel: 4,
                 searchKeywords: `${p} ${r} ${pr}`
              });
            }
          }
        }
      }
    }
    
    return opts;
  }

  private envMatchesFilters(env: EnvYearRange): boolean {
    const siteName = (env.siteName ?? '').toString();
    const areaCode = (env.areaCode ?? '').toString();
    const testerType = (env.testerType ?? '').toString();

    if (this.siteFilter && siteName !== this.siteFilter) return false;
    if (this.areaFilter && areaCode !== this.areaFilter) return false;
    if (this.testerTypeFilter && testerType !== this.testerTypeFilter) return false;
    return true;
  }

  get siteFilterOptions(): GlassOption[] {
    const standardEnvs = this.envs.filter(e => e.dbCode !== 'edbfound');

    const filtered = standardEnvs.filter(e => {
      if (this.areaFilter) return (e.areaCode ?? '') === this.areaFilter;
      return true;
    }).filter(e => {
      if (this.testerTypeFilter) return (e.testerType ?? '') === this.testerTypeFilter;
      return true;
    });

    const sites = Array.from(new Set(filtered.map(e => e.siteName).filter(Boolean))).sort((a, b) => a.localeCompare(b));
    return sites.map(s => ({ value: s, label: s }));
  }

  get areaFilterOptions(): GlassOption[] {
    const standardEnvs = this.envs.filter(e => e.dbCode !== 'edbfound');

    const filtered = standardEnvs.filter(e => {
      if (this.siteFilter) return (e.siteName ?? '') === this.siteFilter;
      return true;
    }).filter(e => {
      if (this.testerTypeFilter) return (e.testerType ?? '') === this.testerTypeFilter;
      return true;
    });

    const areas = Array.from(new Set(filtered.map(e => e.areaCode).filter(Boolean))).sort((a, b) => a.localeCompare(b));
    return areas.map(a => ({ value: a, label: a }));
  }

  get testerTypeFilterOptions(): GlassOption[] {
    const standardEnvs = this.envs.filter(e => e.dbCode !== 'edbfound');

    const filtered = standardEnvs.filter(e => {
      if (this.siteFilter) return (e.siteName ?? '') === this.siteFilter;
      return true;
    }).filter(e => {
      if (this.areaFilter) return (e.areaCode ?? '') === this.areaFilter;
      return true;
    });

    const testers = Array.from(new Set(filtered.map(e => e.testerType).filter(Boolean))).sort((a, b) => a.localeCompare(b));
    return testers.map(t => ({ value: t, label: t }));
  }

  private syncEnvironmentSelectionWithFilters(): void {
    const matches = this.envs.filter(e => this.envMatchesFilters(e)).sort((a, b) => a.environment.localeCompare(b.environment));

    const currentOk = this.environment && matches.some(m => m.environment === this.environment);
    if (currentOk) return;

    this.environment = matches.length ? matches[0].environment : '';
    this.environmentChange.emit(this.environment);
  }

  onSiteFilterChange(v: string) {
    this.siteFilter = v ?? '';
    this.syncEnvironmentSelectionWithFilters();
  }

  onAreaFilterChange(v: string) {
    this.areaFilter = v ?? '';
    this.syncEnvironmentSelectionWithFilters();
  }

  onTesterTypeFilterChange(v: string) {
    this.testerTypeFilter = v ?? '';
    this.syncEnvironmentSelectionWithFilters();
  }

  get yearOptions(): GlassOption[] {
    const env = this.envs.find(e => e.environment === this.environment);
    if (!env || !env.startYear || !env.endYear) return [];
    const opts: GlassOption[] = [];
    for (let y = env.endYear; y >= env.startYear; y--) {
      opts.push({ value: y, label: String(y) });
    }
    return opts;
  }

  monthOptions: GlassOption[] = [
    { value: 1, label: 'January' }, { value: 2, label: 'February' },
    { value: 3, label: 'March' }, { value: 4, label: 'April' },
    { value: 5, label: 'May' }, { value: 6, label: 'June' },
    { value: 7, label: 'July' }, { value: 8, label: 'August' },
    { value: 9, label: 'September' }, { value: 10, label: 'October' },
    { value: 11, label: 'November' }, { value: 12, label: 'December' }
  ];

  onEnvironmentChange(env: string) {
    this.environment = env;
    this.environmentChange.emit(env);
    // Clear years if they are out of bounds? Left as is for now, they just become invalid options
  }

  addRow() {
    this.searchRows.update((rows: SearchRow[]) => [...rows, { id: ++this.rowIdCounter, lotsRaw: '' }]);
  }

  removeRow(id: number) {
    this.searchRows.update((rows: SearchRow[]) => rows.filter((r: SearchRow) => r.id !== id));
  }

  updateRow(id: number, field: keyof SearchRow, value: any) {
    this.searchRows.update((rows: SearchRow[]) => 
      rows.map((r: SearchRow) => r.id === id ? { ...r, [field]: value } : r)
    );
  }

  get statusTone(): 'info' | 'success' | 'warning' {
    const s = (this.lastStatus?.status ?? '').toLowerCase();
    if (s.includes('failed')) return 'warning';
    if (s.includes('completed')) return 'success';
    return 'info';
  }

  stepActive(step: number): boolean {
    if (step === 1) return this.searchRows().some((r: SearchRow) => r.lotsRaw.trim().length > 0) || this.hasResults;
    if (step === 2) return !!this.currentSessionId;
    if (step === 3) return !!this.lastStatus;
    return false;
  }
}
