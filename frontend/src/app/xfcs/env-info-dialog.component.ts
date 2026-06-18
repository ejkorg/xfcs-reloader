import { Component, Inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { XfcsApiService } from '../api/xfcs-api.service';
import { EnvInfo } from '../api/xfcs-models';

@Component({
  selector: 'app-env-info-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule],
  template: `
    <h2 class="dialog-title">Environment Details</h2>
    <div class="dialog-content">
      <div *ngIf="loading" class="loading"><span class="spinner"></span></div>
      <div *ngIf="!loading && info">
        <p><strong>Environment:</strong> {{ info.environment }}</p>
        <p><strong>Config source:</strong> {{ info.configSource || 'N/A' }}</p>
        <p><strong>Config path:</strong> {{ info.cfgPath }}</p>
        <p><strong>Inbox path:</strong> {{ info.inboxPath }}</p>
        <p><strong>Active:</strong> {{ info.active ? 'Yes' : 'No' }}</p>
        <p><strong>File count:</strong> {{ info.fileCount }}</p>
      </div>
      <div *ngIf="!loading && !info" class="err">Unable to load environment details.</div>
    </div>
    <div class="dialog-actions">
      <button type="button" class="btn btn-outline" mat-dialog-close>Close</button>
    </div>
  `,
  styles: [`
    .dialog-title{font-size:1.15rem;padding-bottom:.5rem}
    .dialog-content{padding:.2rem 0 .35rem}
    .loading{display:flex;justify-content:center;padding:18px}
    .spinner{width:24px;height:24px;border:3px solid color-mix(in srgb, var(--card-border) 95%, transparent);border-top-color:var(--accent-color);border-radius:50%;animation:spin .8s linear infinite}
    .err{color:var(--error)}
    .dialog-actions{display:flex;justify-content:flex-end;padding-top:.55rem}
    .btn{height:36px;padding:0 .8rem;border-radius:10px;font-weight:700;cursor:pointer;border:1px solid transparent}
    .btn-outline{background:color-mix(in srgb, var(--card-bg) 86%, transparent);color:var(--text-main);border-color:var(--card-border)}
    @keyframes spin{to{transform:rotate(360deg)}}
  `]
})
export class EnvInfoDialogComponent implements OnInit {
  loading = true;
  info?: EnvInfo;

  constructor(@Inject(MAT_DIALOG_DATA) public data: { environment: string }, private api: XfcsApiService) {}

  ngOnInit(): void {
    this.api.getEnvInfo(this.data.environment).subscribe({
      next: (info: EnvInfo) => {
        this.info = info;
        this.loading = false;
      },
      error: () => {
        this.loading = false;
      }
    });
  }
}
