import { Component, Input, Output, EventEmitter, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GlassButtonComponent } from '../shared/components/glass-button.component';
import { GlassIconComponent } from '../shared/components/glass-icon.component';
import { SearchResult } from '../api/xfcs-models';
 
@Component({
  standalone: true,
  selector: 'app-xfcs-results-table',
  imports: [CommonModule, FormsModule, GlassButtonComponent, GlassIconComponent],
  template: `
    <section class="results-panel glass-panel" *ngIf="results.length">
      <div class="panel-header">
        <div class="panel-title">
          <app-glass-icon name="search" [size]="18" color="primary"></app-glass-icon>
          <span>Archive Search Results</span>
          <span class="count-badge">{{ filteredResults().length }} / {{ results.length }}</span>
          <span class="selection-badge" *ngIf="selectedFiles.size > 0">
            {{ selectedFiles.size }} selected
          </span>
        </div>
 
        <div class="header-actions">
          <app-glass-button variant="tertiary" size="small" (clicked)="toggleAll()">
            {{ allSelected ? 'Deselect All' : 'Select All' }}
          </app-glass-button>
        </div>
      </div>
 
      <!-- FILTER BAR -->
      <div class="filter-bar">
        <div class="search-box">
          <app-glass-icon name="filter_list" [size]="16" color="muted"></app-glass-icon>
          <input type="text" 
                 [(ngModel)]="searchText" 
                 placeholder="Filter by Filename or Lot ID..." 
                 class="filter-input">
        </div>
        <div class="type-filters">
          <button class="filter-pill" 
                  [class.active]="activeType() === 'all'" 
                  (click)="activeType.set('all')">ALL</button>
          <button *ngFor="let t of availableTypes()" class="filter-pill"
                  [class.active]="activeType() === t"
                  (click)="activeType.set(t)">
            {{ t }}
          </button>
        </div>
      </div>
 
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th class="check-col"></th>
              <th>Lot ID</th>
              <th>Filename</th>
              <th>Year / Month</th>
              <th>Archive Path</th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let r of filteredResults(); let i = index" 
                [class.alt-row]="i % 2 === 1"
                [class.selected-row]="isSelected(r)"
                (click)="toggleSelection(r)">
              <td class="check-col">
                <div class="glass-check" [class.checked]="isSelected(r)">
                  <app-glass-icon name="check" [size]="12" *ngIf="isSelected(r)"></app-glass-icon>
                </div>
              </td>
              <td class="lot-cell">
                <span class="lot-pill">{{ r.lotId || '—' }}</span>
              </td>
              <td class="filename-cell">{{ r.filename }}</td>
              <td class="period-cell">
                <span *ngIf="r.year">{{ r.year }}/{{ (r.month ?? 0) | number:'2.0-0' }}</span>
                <span *ngIf="!r.year" class="dash">—</span>
              </td>
              <td class="path-cell">
                <span class="path-mono" title="{{ r.path }}">{{ r.path }}</span>
              </td>
            </tr>
 
            <tr *ngIf="filteredResults().length === 0">
              <td colspan="5" class="empty-results">
                No files match your current filters.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  `,
  styles: [`
    .results-panel { padding: 0; overflow: hidden; margin-top: 1rem; }
 
    .panel-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 1rem 1.25rem;
      border-bottom: 1px solid var(--card-border);
    }
 
    .panel-title {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-weight: 700;
      font-size: 0.9rem;
    }
 
    .count-badge {
      background: rgba(129, 140, 248, 0.1);
      color: var(--accent-color);
      border: 1px solid rgba(129, 140, 248, 0.2);
      border-radius: 999px;
      padding: 0.15rem 0.55rem;
      font-size: 0.72rem;
      font-weight: 700;
      margin-right: 0.5rem;
    }
 
    .selection-badge {
      font-size: 0.72rem;
      font-weight: 700;
      color: var(--success);
      background: rgba(16, 185, 129, 0.1);
      padding: 0.15rem 0.55rem;
      border-radius: 999px;
      border: 1px solid rgba(16, 185, 129, 0.2);
    }
 
    .filter-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.75rem 1.25rem;
      background: rgba(255, 255, 255, 0.02);
      border-bottom: 1px solid var(--card-border);
      gap: 1rem;
    }
 
    .search-box {
      flex: 1;
      display: flex;
      align-items: center;
      gap: 0.75rem;
      background: rgba(0, 0, 0, 0.2);
      padding: 0.4rem 0.8rem;
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.05);
    }
 
    .filter-input {
      background: transparent;
      border: none;
      color: #fff;
      font-size: 0.85rem;
      width: 100%;
      outline: none;
    }
 
    .type-filters { display: flex; gap: 0.35rem; }
    .filter-pill {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      color: var(--text-muted);
      font-size: 0.65rem;
      font-weight: 800;
      padding: 0.3rem 0.7rem;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .filter-pill:hover { background: rgba(255, 255, 255, 0.1); color: #fff; }
    .filter-pill.active {
      background: var(--accent-color);
      border-color: var(--accent-color);
      color: #fff;
      box-shadow: 0 0 10px rgba(129, 140, 248, 0.3);
    }
 
    .table-scroll {
      max-height: 420px;
      overflow: auto;
    }
 
    table { width: 100%; border-collapse: collapse; }
    thead { position: sticky; top: 0; z-index: 10; }
    th {
      background: #1a1635;
      border-bottom: 1px solid var(--card-border);
      padding: 0.75rem 0.9rem;
      font-size: 0.75rem;
      font-weight: 700;
      text-align: left;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
    }
 
    td { padding: 0.75rem 0.9rem; font-size: 0.85rem; border-bottom: 1px solid rgba(255,255,255,0.05); cursor: pointer; }
    tr:hover td { background: rgba(129, 140, 248, 0.05); }
    .selected-row td { background: rgba(129, 140, 248, 0.1) !important; }
    .alt-row td { background: rgba(255, 255, 255, 0.01); }
 
    .check-col { width: 44px; text-align: center; }
    .glass-check {
      width: 18px;
      height: 18px;
      border-radius: 4px;
      border: 2px solid rgba(255,255,255,0.2);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: rgba(255,255,255,0.03);
    }
    .glass-check.checked { background: var(--accent-color); border-color: var(--accent-color); }
 
    .lot-pill {
      background: rgba(129, 140, 248, 0.1);
      color: var(--accent-color);
      border: 1px solid rgba(129, 140, 248, 0.2);
      border-radius: 4px;
      padding: 0.1rem 0.4rem;
      font-size: 0.75rem;
      font-weight: 700;
    }
 
    .path-mono {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-family: monospace;
      font-size: 0.75rem;
      color: var(--text-muted);
      max-width: 400px;
    }
 
    .empty-results { padding: 3rem; text-align: center; color: var(--text-muted); font-style: italic; }
  `]
})
export class XfcsResultsTableComponent {
  @Input() set results(value: SearchResult[]) {
    const next = value ?? [];
    const previousSelectedPaths = new Set(Array.from(this.selectedFiles).map(r => r.path));

    this._results.set(next);

    if (this.externalSelectionBound) {
      this.syncSelectionFromPaths(this._selectedPaths(), true);
    } else {
      // Preserve selection by file path across result refreshes while dropping stale items.
      this.selectedFiles.clear();
      for (const r of next) {
        if (previousSelectedPaths.has(r.path)) {
          this.selectedFiles.add(r);
        }
      }
      this.selectionChanged.emit(Array.from(this.selectedFiles));
    }

    // If the user had a type filter selected but the new results don't contain that type,
    // fall back to ALL to avoid "No files match" confusion.
    const currentType = this.activeType();
    if (currentType !== 'all' && !this.getAvailableTypesInternal().includes(currentType)) {
      this.activeType.set('all');
    }
  }
  get results() { return this._results(); }

  @Input() set selectedPaths(value: string[]) {
    this.externalSelectionBound = true;
    const normalized = (value ?? []).filter((p): p is string => !!p && p.trim().length > 0);
    this._selectedPaths.set(normalized);
    this.syncSelectionFromPaths(normalized, false);
  }
 
  @Output() selectionChanged = new EventEmitter<SearchResult[]>();
 
  private _results = signal<SearchResult[]>([]);
  private _selectedPaths = signal<string[]>([]);
  private externalSelectionBound = false;
  searchText = signal<string>('');
  activeType = signal<string>('all');
 
  filteredResults = computed(() => {
    const raw = this._results();
    const search = this.searchText().toLowerCase().trim();
    const type = this.activeType();
 
    return raw.filter((r: SearchResult) => {
      const matchesSearch = !search || 
        r.filename.toLowerCase().includes(search) || 
        (r.lotId && r.lotId.toLowerCase().includes(search));
      
      const matchesType = type === 'all' || 
        this.extractFileType(r.filename) === type;
 
      return matchesSearch && matchesType;
    });
  });
 
  availableTypes = computed(() => this.getAvailableTypesInternal());

  private getAvailableTypesInternal(): string[] {
    const types: string[] = this._results()
      .map((r: SearchResult) => this.extractFileType(r.filename))
      .filter((v: string | null): v is string => v != null && v !== '');

    return Array.from(new Set<string>(types)).sort((a: string, b: string) => a.localeCompare(b));
  }

  private extractFileType(filename: string): string | null {
    if (!filename) return null;

    // Strip common archive suffixes so the token before them is considered.
    let base = filename.replace(/(\.gz|\.zip)$/i, '');

    // Preferred: token right before "MD5" marker (e.g. ".LSR_MD5-", ".STDF-MD5-")
    const md5 = base.match(/\.([A-Za-z0-9]+)[_\-\.]?MD5/i);
    if (md5 && md5[1]) {
      return md5[1].toUpperCase();
    }

    const lastDot = base.lastIndexOf('.');
    if (lastDot < 0 || lastDot === base.length - 1) return null;

    const tail = base.substring(lastDot + 1);
    // Token is up to '_' '-' '.'
    const token = tail.split(/[_\-\.]/)[0]?.trim();
    if (!token) return null;

    return token.toUpperCase();
  }

  selectedFiles = new Set<SearchResult>();

  private syncSelectionFromPaths(paths: string[], emit: boolean): void {
    const wanted = new Set(paths);
    this.selectedFiles.clear();
    for (const r of this._results()) {
      if (wanted.has(r.path)) {
        this.selectedFiles.add(r);
      }
    }

    if (emit) {
      this.selectionChanged.emit(Array.from(this.selectedFiles));
    }
  }
 
  isSelected(r: SearchResult): boolean {
    return this.selectedFiles.has(r);
  }
 
  toggleSelection(r: SearchResult): void {
    if (this.selectedFiles.has(r)) {
      this.selectedFiles.delete(r);
    } else {
      this.selectedFiles.add(r);
    }
    this.selectionChanged.emit(Array.from(this.selectedFiles));
  }
 
  get allSelected(): boolean {
    const current = this.filteredResults();
    return current.length > 0 && current.every((r: SearchResult) => this.selectedFiles.has(r));
  }
 
  toggleAll(): void {
    const current = this.filteredResults();
    if (this.allSelected) {
      current.forEach((r: SearchResult) => this.selectedFiles.delete(r));
    } else {
      current.forEach((r: SearchResult) => this.selectedFiles.add(r));
    }
    this.selectionChanged.emit(Array.from(this.selectedFiles));
  }
}
