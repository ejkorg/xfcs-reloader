import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { ArchiveLotDetail } from '../api/xfcs-models';
import { XfcsApiService } from '../api/xfcs-api.service';

@Component({
  selector: 'app-find-archive-lots-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule],
  template: `
    <h2 class="dialog-title">Find Lots in Archive</h2>
    <div class="dialog-content">
      <div class="filters">
        <label class="field-label" for="lot">Lot</label>
        <input id="lot" class="control" [(ngModel)]="lot">
        <label class="field-label" for="wafer">Wafer</label>
        <input id="wafer" class="control" [(ngModel)]="wafer">
        <button type="button" class="btn btn-primary" (click)="search()"><span class="material-icons">search</span>Search</button>
      </div>

      <div *ngIf="loading" class="loading"><span class="spinner"></span></div>

      <div *ngIf="!loading && results.length">
        <ul class="results">
          <li *ngFor="let r of results">
            <strong>{{ r.lot }}</strong>
            <span *ngIf="r.wafer"> / {{ r.wafer }}</span>
            - {{ r.filename || '-' }}
            <small>{{ r.archivePath || '-' }}</small>
          </li>
        </ul>
      </div>

      <p *ngIf="!loading && searched && !results.length" class="muted">No lots found.</p>
    </div>
    <div class="dialog-actions">
      <button type="button" class="btn btn-outline" mat-dialog-close>Close</button>
    </div>
  `,
  styles: [`
    .dialog-title{font-size:1.15rem;padding-bottom:.5rem}
    .dialog-content{padding:.2rem 0 .4rem}
    .filters{display:grid;grid-template-columns:1fr 1fr auto;gap:.45rem .6rem;align-items:end}
    .field-label{font-size:.8rem;color:var(--text-muted);font-weight:600}
    .control{height:40px;border-radius:12px;border:1px solid var(--card-border);background:color-mix(in srgb, var(--card-bg) 86%, transparent);color:var(--text-main);padding:0 .68rem;outline:none}
    .control:focus{border-color:var(--accent-color);box-shadow:0 0 0 3px color-mix(in srgb, var(--accent-color) 16%, transparent)}
    .loading{display:flex;justify-content:center;padding:18px}
    .spinner{width:24px;height:24px;border:3px solid color-mix(in srgb, var(--card-border) 95%, transparent);border-top-color:var(--accent-color);border-radius:50%;animation:spin .8s linear infinite}
    .results{margin-top:10px;padding-left:18px}
    .results li{margin-bottom:8px}
    .dialog-actions{display:flex;justify-content:flex-end;padding-top:.6rem}
    .btn{height:36px;padding:0 .78rem;border-radius:10px;font-weight:700;cursor:pointer;border:1px solid transparent;display:inline-flex;align-items:center;gap:.35rem}
    .btn-primary{background:linear-gradient(135deg,var(--accent-color),#7c3aed);color:#fff}
    .btn-outline{background:color-mix(in srgb, var(--card-bg) 86%, transparent);color:var(--text-main);border-color:var(--card-border)}
    .muted{color:var(--text-muted)}
    @media (max-width:760px){.filters{grid-template-columns:1fr}}
    @keyframes spin{to{transform:rotate(360deg)}}
  `]
})
export class FindArchiveLotsDialogComponent {
  lot = '';
  wafer = '';
  loading = false;
  searched = false;
  results: ArchiveLotDetail[] = [];

  constructor(@Inject(MAT_DIALOG_DATA) public data: { environment: string }, private api: XfcsApiService) {}

  search(): void {
    this.loading = true;
    this.searched = true;
    this.api.findArchiveLots(this.data.environment, this.lot || undefined, this.wafer || undefined).subscribe({
      next: (rows: ArchiveLotDetail[]) => {
        this.results = rows;
        this.loading = false;
      },
      error: () => {
        this.results = [];
        this.loading = false;
      }
    });
  }
}
