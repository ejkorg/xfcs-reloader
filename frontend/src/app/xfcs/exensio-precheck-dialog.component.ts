import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GlassButtonComponent } from '../shared/components/glass-button.component';
import { ExensioPreCheckResponse } from '../api/xfcs-models';

@Component({
  selector: 'app-exensio-precheck-dialog',
  standalone: true,
  imports: [CommonModule, GlassButtonComponent],
  template: `
    <div class="precheck-dialog-overlay" *ngIf="result">
      <div class="precheck-dialog-panel">
        <!-- Header -->
        <div class="dialog-header">
          <div class="header-title-group">
            <span class="material-icons warning-icon">warning</span>
            <h3 class="dialog-title">⚠ Lots Found in Exensio</h3>
          </div>
          <button type="button" class="btn-close" (click)="goBack.emit()">
            <span class="material-icons">close</span>
          </button>
        </div>

        <!-- Summary -->
        <div class="dialog-summary">
          <p class="summary-text">
            {{ result.lotsFound.length }} of {{ getTotalSubmittedLots() }} lots already found in Exensio
          </p>
        </div>

        <!-- Results Table -->
        <div class="dialog-results-wrapper">
          <table class="results-table">
            <thead>
              <tr>
                <th>lot_id</th>
                <th>schema_loaded</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let row of result.rows" class="result-row">
                <td class="cell-lot-id">{{ row.lotId }}</td>
                <td class="cell-schema" [class.schema-prod]="isProd(row.schemaName)"
                    [class.schema-notfound]="isNotFound(row.schemaName)">
                  {{ row.schemaName }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Action Buttons -->
        <div class="dialog-actions">
          <app-glass-button variant="secondary" (clicked)="exportCsv()">
            <span class="material-icons" style="font-size:0.9rem">download</span>
            <span>Export CSV</span>
          </app-glass-button>
          <div class="button-group">
            <app-glass-button variant="secondary" (clicked)="goBack.emit()">
              Go Back
            </app-glass-button>
            <app-glass-button variant="primary" (clicked)="proceed.emit()">
              Proceed Anyway
            </app-glass-button>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .precheck-dialog-overlay {
      position: fixed;
      inset: 0;
      z-index: 1000;
      background: rgba(15, 12, 41, 0.8);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1rem;
    }

    .precheck-dialog-panel {
      display: flex;
      flex-direction: column;
      max-width: 520px;
      width: 100%;
      max-height: 80vh;
      border-radius: 16px;
      border: 1px solid rgba(129, 140, 248, 0.25);
      background: rgba(30, 24, 64, 0.95);
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
      animation: slideUp 0.3s ease-out;
    }

    @keyframes slideUp {
      from { opacity: 0; transform: translateY(20px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    .dialog-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 1.5rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    }

    .header-title-group {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .warning-icon {
      font-size: 1.6rem;
      color: #f59e0b;
      flex-shrink: 0;
    }

    .dialog-title {
      margin: 0;
      font-size: 1.1rem;
      font-weight: 700;
      color: #fff;
      letter-spacing: -0.01em;
    }

    .btn-close {
      background: transparent;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      padding: 0.4rem;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 8px;
      transition: all 0.2s;
    }

    .btn-close:hover {
      background: rgba(255, 255, 255, 0.08);
      color: #fff;
    }

    .dialog-summary {
      padding: 1rem 1.5rem;
      background: rgba(251, 191, 36, 0.06);
      border-bottom: 1px solid rgba(251, 191, 36, 0.2);
    }

    .summary-text {
      margin: 0;
      font-size: 0.95rem;
      font-weight: 600;
      color: #fbbf24;
      letter-spacing: 0.02em;
    }

    .dialog-results-wrapper {
      flex: 1;
      overflow-y: auto;
      max-height: 400px;
      padding: 0;
    }

    .results-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.85rem;
    }

    .results-table thead {
      position: sticky;
      top: 0;
      background: rgba(30, 24, 64, 0.9);
      border-bottom: 1px solid rgba(129, 140, 248, 0.2);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
    }

    .results-table th {
      padding: 0.75rem;
      text-align: left;
      font-weight: 700;
      color: var(--accent-color);
      text-transform: uppercase;
      font-size: 0.7rem;
      letter-spacing: 0.05em;
      border-right: 1px solid rgba(129, 140, 248, 0.1);
    }

    .results-table th:last-child { border-right: none; }

    .result-row {
      border-bottom: 1px solid rgba(255, 255, 255, 0.03);
      transition: background 0.2s;
    }

    .result-row:hover { background: rgba(129, 140, 248, 0.05); }

    .results-table td {
      padding: 0.6rem 0.75rem;
      color: #fff;
      border-right: 1px solid rgba(129, 140, 248, 0.08);
      font-family: monospace;
    }

    .results-table td:last-child { border-right: none; }

    .cell-lot-id {
      font-weight: 700;
      color: var(--accent-color);
    }

    .cell-schema { color: rgba(255, 255, 255, 0.85); font-size: 0.82rem; }
    .cell-schema.schema-prod  { color: #34d399; }
    .cell-schema.schema-notfound { color: rgba(255, 255, 255, 0.4); font-style: italic; }

    .dialog-actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      padding: 1.5rem;
      border-top: 1px solid rgba(255, 255, 255, 0.05);
      background: rgba(255, 255, 255, 0.01);
    }

    .button-group { display: flex; gap: 0.75rem; }

    @media (max-width: 480px) {
      .precheck-dialog-panel {
        max-width: 100%;
        max-height: 90vh;
        border-radius: 12px;
      }
      .dialog-header { padding: 1rem; }
      .dialog-actions { flex-direction: column; gap: 0.75rem; }
      .button-group { width: 100%; flex-direction: column; }
    }
  `]
})
export class ExensioPreCheckDialogComponent {
  @Input() result!: ExensioPreCheckResponse;
  @Input() environment!: string;
  @Output() proceed = new EventEmitter<void>();
  @Output() goBack  = new EventEmitter<void>();

  getTotalSubmittedLots(): number {
    if (!this.result) return 0;
    return this.result.lotsFound.length + this.result.lotsNotFound.length;
  }

  isProd(schemaName: string): boolean {
    return schemaName?.toUpperCase().includes('PROD') ?? false;
  }

  isNotFound(schemaName: string): boolean {
    return schemaName === 'NOT FOUND';
  }

  exportCsv(): void {
    if (!this.result) return;

    const header = 'lot_id,schema_loaded\n';
    const body = this.result.rows
      .map(r => [r.lotId, r.schemaName]
        .map(v => '"' + (v ?? '').replace(/"/g, '""') + '"')
        .join(','))
      .join('\n');

    const blob = new Blob([header + body], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const ts   = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `exensio-precheck-${this.environment}-${ts}.csv`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
