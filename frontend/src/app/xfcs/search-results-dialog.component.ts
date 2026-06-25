import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { GlassButtonComponent } from '../shared/components/glass-button.component';
import { GlassIconComponent } from '../shared/components/glass-icon.component';

type SearchResultsDialogData = {
  total: number;
  totalFound: number;
  maxResults: number;
  limitExceeded: boolean;
  foundLots: string[];
  missingLots: string[];
};

@Component({
  selector: 'app-search-results-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, GlassButtonComponent, GlassIconComponent],
  template: `
    <div class="dialog-header">
      <div class="icon-box" [class.success]="data.total > 0" [class.warning]="data.total === 0">
        <app-glass-icon [name]="data.total > 0 ? 'check_circle' : 'search_off'" [size]="20" color="default"></app-glass-icon>
      </div>
      <h2 class="dialog-title">{{ data.total > 0 ? 'Search Summary' : 'No Files Found' }}</h2>
    </div>

    <div class="dialog-content">
      <p *ngIf="data.total > 0">Found <strong>{{ data.total }}</strong> file(s) matching your criteria
        <span *ngIf="data.limitExceeded" class="limit-warning">
          (limited to {{ data.maxResults }}, {{ data.totalFound - data.total }} more available)
        </span>.
      </p>
      <p *ngIf="data.total === 0">No archived files were found for the selected criteria.</p>

      <div class="lot-grid" *ngIf="data.foundLots.length">
        <h4>Found lots ({{ data.foundLots.length }})</h4>
        <div class="chips">
          <span class="chip ok" *ngFor="let lot of data.foundLots">{{ lot }}</span>
        </div>
      </div>

      <div class="lot-grid" *ngIf="data.missingLots.length">
        <h4>Missing lots ({{ data.missingLots.length }})</h4>
        <div class="chips">
          <span class="chip warn" *ngFor="let lot of data.missingLots">{{ lot }}</span>
        </div>
      </div>
    </div>

    <div class="dialog-actions">
      <app-glass-button variant="secondary" (clicked)="close(false)">Cancel</app-glass-button>
      <app-glass-button variant="primary" (clicked)="close(true)" [disabled]="data.total === 0">Preview Results</app-glass-button>
    </div>
  `,
  styles: [`
    :host { display: block; padding: 1.25rem; }
    
    .dialog-header { display: flex; align-items: center; gap: 0.85rem; padding-bottom: 1.15rem; border-bottom: 1px solid rgba(255,255,255,0.06); margin-bottom: 1.15rem; }
    :host-context(body.light-theme) .dialog-header { border-bottom-color: rgba(0,0,0,0.06); }
    
    .icon-box { width: 38px; height: 38px; border-radius: 12px; display: grid; place-items: center; }
    .icon-box.success { background: color-mix(in srgb, var(--success) 20%, transparent); color: var(--success); }
    .icon-box.warning { background: color-mix(in srgb, var(--warning) 20%, transparent); color: var(--warning); }
    
    .dialog-title { font-size: 1.25rem; font-weight: 700; color: #fff; margin: 0; letter-spacing: -0.01em; }
    :host-context(body.light-theme) .dialog-title { color: var(--text-main); }
    
    .dialog-content { padding: 0 0 1.25rem 0; color: var(--text-muted); line-height: 1.5; font-size: 0.95rem; }
    
    .limit-warning { display: inline-block; margin-left: 0.5rem; padding: 0.25rem 0.6rem; border-radius: 4px; background: rgba(245,158,11,0.15); color: #f59e0b; font-size: 0.85rem; font-weight: 600; }
    
    .lot-grid { margin-top: 1.25rem; background: rgba(0,0,0,0.18); border: 1px solid rgba(255,255,255,0.04); padding: 1.1rem; border-radius: 14px; }
    :host-context(body.light-theme) .lot-grid { background: rgba(0,0,0,0.02); border-color: rgba(0,0,0,0.05); }
    
    .lot-grid h4 { margin: 0 0 0.8rem 0; font-size: 0.72rem; color: var(--text-muted); font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; }
    
    .chips { display: flex; gap: 0.5rem; flex-wrap: wrap; }
    .chip { padding: 0.35rem 0.85rem; border-radius: 8px; font-size: 0.8rem; font-weight: 600; font-family: monospace; letter-spacing: 0.5px; }
    
    .chip.ok { background: color-mix(in srgb, var(--success) 15%, transparent); color: var(--success); border: 1px solid color-mix(in srgb, var(--success) 35%, transparent); }
    .chip.warn { background: color-mix(in srgb, var(--warning) 15%, transparent); color: var(--warning); border: 1px solid color-mix(in srgb, var(--warning) 35%, transparent); box-shadow: 0 0 15px rgba(245, 158, 11, 0.08); }
    
    .dialog-actions { display: flex; justify-content: flex-end; gap: 0.75rem; padding-top: 1.25rem; border-top: 1px solid rgba(255,255,255,0.06); }
    :host-context(body.light-theme) .dialog-actions { border-top-color: rgba(0,0,0,0.06); }
  `]
})
export class SearchResultsDialogComponent {
  public readonly data: SearchResultsDialogData;

  constructor(
    private dialogRef: MatDialogRef<SearchResultsDialogComponent>,
    @Inject(MAT_DIALOG_DATA) rawData: Partial<SearchResultsDialogData> | null
  ) {
    this.data = {
      total: rawData?.total ?? 0,
      totalFound: rawData?.totalFound ?? rawData?.total ?? 0,
      maxResults: rawData?.maxResults ?? 0,
      limitExceeded: rawData?.limitExceeded ?? false,
      foundLots: rawData?.foundLots ?? [],
      missingLots: rawData?.missingLots ?? []
    };
  }

  close(result: boolean): void {
    this.dialogRef.close(result);
  }
}
