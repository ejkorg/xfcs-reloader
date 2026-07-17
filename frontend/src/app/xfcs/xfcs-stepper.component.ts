import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { firstValueFrom, catchError, of } from 'rxjs';
import { GlassButtonComponent } from '../shared/components/glass-button.component';
import { GlassSelectComponent, GlassOption } from '../shared/components/glass-select.component';
import { GlassIconComponent } from '../shared/components/glass-icon.component';
import { XfcsResultsTableComponent } from './xfcs-results-table.component';
import { XfcsSessionMonitorComponent } from './xfcs-session-monitor.component';
import { XfcsFileMonitorComponent } from './xfcs-file-monitor.component';
import { ExensioPreCheckDialogComponent } from './exensio-precheck-dialog.component';
import { XfcsApiService } from '../api/xfcs-api.service';
import { EnvYearRange, ExensioPreCheckRequest, ExensioPreCheckResponse, ReloadRequest, SearchCriteria, SearchResult, ReloadStatus, ReloadSession } from '../api/xfcs-models';
import { ToastService } from '../shared/services/toast.service';

export interface SearchRow {
  id: number;
  year?: number;
  month?: number;
  lotsRaw: string;
  lots: string[];
  rejectedLots: string[]; // tokens that were too short
}

@Component({
  selector: 'app-xfcs-stepper',
  standalone: true,
  imports: [
    CommonModule, 
    FormsModule, 
    RouterModule,
    GlassButtonComponent, 
    GlassSelectComponent, 
    GlassIconComponent,
    XfcsResultsTableComponent,
    XfcsSessionMonitorComponent,
    XfcsFileMonitorComponent,
    ExensioPreCheckDialogComponent
  ],
  template: `
    <div class="stepper-root">
      <header class="stepper-header">
        <div class="title-group">
          <h1>New <span class="accent">Reload Request</span></h1>
          <p class="subtitle">Follow the steps to find and re-archive files from the storage vaults.</p>
        </div>
        <div class="stepper-progress">
          <div class="step-indicator" [class.active]="currentStep() >= 1" [class.completed]="currentStep() > 1">
            <span class="step-num">1</span>
            <span class="step-label">Selection</span>
          </div>
          <div class="step-connector"></div>
          <div class="step-indicator" [class.active]="currentStep() >= 2" [class.completed]="currentStep() > 2">
            <span class="step-num">2</span>
            <span class="step-label">Discovery</span>
          </div>
          <div class="step-connector"></div>
          <div class="step-indicator" [class.active]="currentStep() >= 3" [class.completed]="currentStep() > 3">
            <span class="step-num">3</span>
            <span class="step-label">Review</span>
          </div>
          <div class="step-connector"></div>
          <div class="step-indicator" [class.active]="currentStep() >= 4" [class.completed]="currentStep() > 4 || isStep4Completed()">
            <span class="step-num">4</span>
            <span class="step-label">Execution</span>
          </div>
        </div>
      </header>

      <main class="stepper-content glass-panel">
        <!-- GLOBAL LOADING OVERLAY -->
        <div class="loading-overlay" *ngIf="searching() || executing() || preChecking()">
          <div class="spinner-box">
            <div class="glass-spinner"></div>
            <p class="loading-msg">{{ preChecking() ? 'Checking Exensio…' : (searching() ? 'Searching Archives...' : 'Dispatching Session...') }}</p>
          </div>
        </div>
 
        <!-- STEP 1: SCOPE SELECTION -->
        <div *ngIf="currentStep() === 1" class="step-pane animate-in">
          <div class="pane-header">
            <h3>Step 1: <span class="accent">Target Selection</span></h3>
            <p>Select the environment and defined search criteria for the lots you need to reload.</p>
          </div>

          <div class="form-container">
            <!-- Site / Area / Tester Type � environment resolves automatically -->
            <div class="filter-row">
              <app-glass-select
                label="Site"
                placeholder="Select site"
                [options]="siteOptions()"
                [ngModel]="filterSite()"
                (ngModelChange)="onFilterSiteChange($event)">
              </app-glass-select>
              <app-glass-select
                label="Area"
                placeholder="Select area"
                [options]="areaOptions()"
                [disabled]="!filterSite()"
                [ngModel]="filterArea()"
                (ngModelChange)="onFilterAreaChange($event)">
              </app-glass-select>
              <app-glass-select
                label="Tester Type"
                placeholder="Select tester type"
                [options]="testerTypeOptions()"
                [disabled]="!filterArea()"
                [ngModel]="filterTesterType()"
                (ngModelChange)="onFilterTesterTypeChange($event)">
              </app-glass-select>
            </div>

            <!-- Disambiguation: only shown when multiple envs match all 3 filters -->
            <app-glass-select
              *ngIf="resolveStatus() === 'ambiguous'"
              label="Environment (multiple matches � pick one)"
              placeholder="Select environment"
              prefixIcon="dataset"
              [options]="resolvedEnvOptions()"
              [ngModel]="environment()"
              (ngModelChange)="environment.set($event)">
            </app-glass-select>

            <!-- Resolved environment confirmation bar -->
            <div class="env-resolved-bar" [class.is-resolved]="!!environment()">
              <ng-container *ngIf="environment(); else envPending">
                <span class="material-icons resolved-icon">check_circle</span>
                <span class="resolved-label">Environment resolved:</span>
                <span class="resolved-env">{{ environment() }}</span>
              </ng-container>
              <ng-template #envPending>
                <span class="material-icons pending-icon">pending</span>
                <span class="pending-label">
                  {{ !filterSite() ? 'Select a site to begin' : !filterArea() ? 'Select an area' : !filterTesterType() ? 'Select a tester type' : 'No environment found for this combination' }}
                </span>
              </ng-template>
            </div>

            <div class="search-rows-container mt-4" [class.rows-disabled]="!environment()">
              <div class="disabled-overlay" *ngIf="!environment()">
                <span class="material-icons">lock</span>
                <span>Select an environment first</span>
              </div>
              <div class="search-row" *ngFor="let row of searchRows(); let i = index">
                <div class="row-header">
                  <span class="row-title">Criteria Block {{ i + 1 }}</span>
                  <div class="row-header-actions">
                    <button type="button" class="btn-clear-lots" *ngIf="row.lots.length > 0" (click)="clearBlockLots(row.id)">
                      <app-glass-icon name="playlist_remove" [size]="14"></app-glass-icon>
                      <span>Clear Lots</span>
                    </button>
                    <button type="button" class="btn-remove" *ngIf="searchRows().length > 1" (click)="removeRow(row.id)">
                      <app-glass-icon name="close" [size]="14"></app-glass-icon>
                    </button>
                  </div>
                </div>
                <div class="row-pickers">
                  <app-glass-select
                    label="Year"
                    placeholder="Any Year"
                    [options]="yearOptions()"
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
                  <div class="lot-chip-input" [class.focused]="row.id === focusedRowId()">
                    <div class="chip-list">
                      <span class="lot-chip" *ngFor="let lot of row.lots">
                        {{ lot }}
                        <button type="button" class="chip-remove" (click)="removeLot(row.id, lot)" tabindex="-1">×</button>
                      </span>
                      <input
                        class="chip-native-input"
                        placeholder="{{ row.lots.length === 0 ? 'Type lot ID, press Enter or comma to add' : 'Add more...' }}"
                        [disabled]="!environment()"
                        (focus)="focusedRowId.set(row.id)"
                        (blur)="onLotInputBlur($event, row.id)"
                        (keydown)="onLotKeydown($event, row.id)"
                        (paste)="onLotPaste($event, row.id)"
                        autocomplete="off"
                        spellcheck="false"
                      />
                    </div>
                  </div>
                  <span class="lot-count-hint" *ngIf="row.lots.length > 0">{{ row.lots.length }} lot{{ row.lots.length !== 1 ? 's' : '' }} added</span>
                  <div class="lot-rejected-hint" *ngIf="row.rejectedLots.length > 0">
                    <span class="material-icons">warning_amber</span>
                    <span>Too short (min 6 chars): <strong>{{ row.rejectedLots.join(', ') }}</strong></span>
                  </div>
                </div>
              </div>
              
              <button type="button" class="btn-add-row" [disabled]="!environment()" (click)="addRow()">
                <app-glass-icon name="add" [size]="16"></app-glass-icon>
                <span>Add Criteria Block</span>
              </button>
            </div>
          </div>

          <div class="pane-footer split mt-6">
            <app-glass-button variant="secondary" (clicked)="resetAll()">
              Reset All
            </app-glass-button>
            <div class="search-footer-right">
              <label class="precheck-toggle">
                <input type="checkbox" [checked]="preCheckEnabled()" (change)="onPreCheckToggle($any($event.target).checked)">
                <span>Check Exensio before searching</span>
              </label>
              <app-glass-button variant="primary" [disabled]="!canSearch()" [loading]="searching() || preChecking()" (clicked)="onSearchClick()">
                Search Archive →
              </app-glass-button>
            </div>
          </div>

          <!-- Exensio Pre-Check Dialog -->
          <app-exensio-precheck-dialog
            *ngIf="showPreCheckDlg() && preCheckResult()"
            [result]="preCheckResult()!"
            [environment]="environment()"
            (proceed)="onPreCheckProceed()"
            (goBack)="onPreCheckGoBack()">
          </app-exensio-precheck-dialog>
        </div>

        <!-- STEP 2: FILE DISCOVERY -->
        <div *ngIf="currentStep() === 2" class="step-pane animate-in">
          <div class="pane-header">
            <h3>Step 2: <span class="accent">File Discovery</span></h3>
            <p>Review the search results and select the specific archive files to be re-archived.</p>
          </div>

          <div class="results-container">
            <!-- Lot Stats Summary Panel (shown after search, when results exist or lots were entered) -->
            <div class="lot-stats-panel" *ngIf="currentStep() === 2 && lotStats().totalEntered > 0">
              <div class="stats-header">
                <h4 class="stats-title">Search Summary</h4>
              </div>
              <div class="stats-grid">
                <div class="stat-item">
                  <span class="stat-label">Total Lots Entered</span>
                  <span class="stat-value">{{ lotStats().totalEntered }}</span>
                </div>
                <div class="stat-item">
                  <span class="stat-label">Lots Found</span>
                  <span class="stat-value found">{{ lotStats().totalFound }}</span>
                </div>
                <div class="stat-item">
                  <span class="stat-label">Lots Not Found</span>
                  <span class="stat-value" [class.warning]="lotStats().totalNotFound > 0">{{ lotStats().totalNotFound }}</span>
                </div>
              </div>

              <!-- Not-found lots list and export button (only when there are not-found lots) -->
              <div class="not-found-section" *ngIf="lotStats().totalNotFound > 0">
                <div class="not-found-header">
                  <button type="button" class="btn-collapse" (click)="toggleNotFoundList()">
                    <span class="material-icons">{{ showNotFoundList() ? 'expand_less' : 'expand_more' }}</span>
                    <span>Not-Found Lots ({{ lotStats().totalNotFound }})</span>
                  </button>
                  <app-glass-button variant="secondary" (clicked)="exportNotFoundCsv()">
                    <span class="material-icons" style="font-size:0.9rem">download</span>
                    <span>Export CSV</span>
                  </app-glass-button>
                </div>
                <div class="not-found-list" *ngIf="showNotFoundList()">
                  <div class="lot-item" *ngFor="let lot of lotStats().notFoundLots">
                    <span class="lot-badge">{{ lot }}</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Empty state: no results found -->
            <div class="empty-state" *ngIf="allSearchResults().length === 0">
              <div class="empty-icon-wrap">
                <span class="material-icons empty-icon">manage_search</span>
                <div class="empty-icon-ring"></div>
              </div>
              <h4 class="empty-title">No Archive Files Found</h4>
              <p class="empty-body">
                The search returned no results for the selected environment and lot IDs.<br>
                This could mean the files haven't been archived yet, or the lot IDs may be incorrect.
              </p>
              <div class="empty-suggestions">
                <div class="suggestion-item">
                  <span class="material-icons">tune</span>
                  <span>Try removing the year or month filter to broaden the search</span>
                </div>
                <div class="suggestion-item">
                  <span class="material-icons">swap_horiz</span>
                  <span>Verify the lot IDs are correct and match the selected environment</span>
                </div>
                <div class="suggestion-item">
                  <span class="material-icons">dataset</span>
                  <span>Confirm the correct environment is selected for these lots</span>
                </div>
              </div>
              <app-glass-button variant="secondary" (clicked)="prevStep()">
                <span class="material-icons" style="font-size:1rem">arrow_back</span>
                Modify Search
              </app-glass-button>
            </div>

            <!-- Display-limit banner: shown when not all results are visible in the table -->
            <div class="display-limit-banner" *ngIf="displayLimited()">
              <span class="material-icons">info_outline</span>
              <span>
                Showing <strong>{{ searchResults().length }}</strong> of <strong>{{ allSearchResults().length }}</strong> matching files.
                The table is capped for performance — but all <strong>{{ allSearchResults().length }}</strong> files can be staged for reload.
              </span>
              <app-glass-button variant="secondary" size="small" (clicked)="selectAllFiles()">
                Select All {{ allSearchResults().length }} Files
              </app-glass-button>
            </div>

            <!-- Results table when files are found -->
            <app-xfcs-results-table
              *ngIf="searchResults().length > 0"
              [results]="searchResults()"
              [selectedPaths]="selectedFilePaths()"
              (selectionChanged)="onSelectionChanged($event)">
            </app-xfcs-results-table>          </div>

          <div class="pane-footer mt-6">
            <app-glass-button variant="secondary" (clicked)="prevStep()">Back</app-glass-button>
            <ng-container *ngIf="allSearchResults().length > 0">
              <app-glass-button
                variant="secondary"
                [loading]="downloading()"
                [disabled]="downloading() || selectedFiles().length === 0"
                (clicked)="downloadDiscoveredFiles()">
                {{ selectedFiles().length > 0 ? ('Download Selected (' + selectedFiles().length + ')') : 'Select Files to Download' }}
              </app-glass-button>
              <app-glass-button variant="primary" [disabled]="selectedFiles().length === 0" (clicked)="nextStep()">
                Review {{ selectedFiles().length }} Files →
              </app-glass-button>
            </ng-container>
          </div>
        </div>

        <!-- STEP 3: REVIEW & CONFIRM -->
        <div *ngIf="currentStep() === 3" class="step-pane animate-in">
          <div class="pane-header">
            <h3>Step 3: <span class="accent">Review & Confirm</span></h3>
            <p>Verify your environment and file selections before dispatching the reload session.</p>
          </div>

          <div class="review-layout">
            <!-- Left Panel: Session Metadata -->
            <div class="review-sidebar">
              <div class="glass-card review-meta-card">
                <div class="card-header">
                  <app-glass-icon name="settings" [size]="18" class="accent-icon"></app-glass-icon>
                  <h4>Target Configuration</h4>
                </div>
                
                <div class="meta-rows">
                  <div class="meta-row">
                    <span class="meta-label">Environment</span>
                    <span class="meta-value env-pill">{{ environment() }}</span>
                  </div>
                  
                  <div class="meta-row" *ngIf="selectedEnvInfo()?.siteName">
                    <span class="meta-label">Site / Area</span>
                    <span class="meta-value">{{ selectedEnvInfo()?.siteName }} / {{ selectedEnvInfo()?.areaCode || 'N/A' }}</span>
                  </div>

                  <div class="meta-row" *ngIf="selectedEnvInfo()?.testerType">
                    <span class="meta-label">Tester Type</span>
                    <span class="meta-value">{{ selectedEnvInfo()?.testerType }}</span>
                  </div>

                  <div class="meta-row">
                    <span class="meta-label">Total Files</span>
                    <span class="meta-value highlight">{{ selectedFiles().length }} files</span>
                  </div>

                  <div class="meta-row">
                    <span class="meta-label">Total Size</span>
                    <span class="meta-value highlight">{{ formatBytes(totalSelectedSize()) }}</span>
                  </div>
                </div>

                <div class="precheck-status-box" *ngIf="preCheckResult()">
                  <div class="status-indicator success" *ngIf="preCheckResult()?.lotsNotFound?.length === 0">
                    <app-glass-icon name="check_circle" [size]="16"></app-glass-icon>
                    <span>All lots pre-validated in Exensio.</span>
                  </div>
                  <div class="status-indicator warning" *ngIf="(preCheckResult()?.lotsNotFound?.length ?? 0) > 0">
                    <app-glass-icon name="warning" [size]="16"></app-glass-icon>
                    <span>{{ preCheckResult()?.lotsNotFound?.length }} lots not found in Exensio.</span>
                  </div>
                </div>
              </div>

              <!-- Safety info notice -->
              <div class="safety-notice">
                <app-glass-icon name="info" [size]="18"></app-glass-icon>
                <div class="notice-text">
                  <h5>Reload Ingestion</h5>
                  <p>Archival data will be extracted from storage and dispatched to the ingestion pipeline. Processing time depends on size and system load.</p>
                </div>
              </div>
            </div>

            <!-- Right Panel: Selected Files Details -->
            <div class="review-main">
              <div class="glass-card file-list-card">
                <div class="card-header">
                  <app-glass-icon name="folder_open" [size]="18" class="accent-icon"></app-glass-icon>
                  <h4>Files to Reload ({{ selectedFiles().length }})</h4>
                </div>

                <div class="file-preview-list">
                  <div class="preview-file-item" *ngFor="let f of selectedFiles() | slice:0:15">
                    <div class="file-info-group">
                      <app-glass-icon name="description" [size]="18" class="file-icon"></app-glass-icon>
                      <div class="file-details">
                        <span class="file-name" [title]="f.filename">{{ f.filename }}</span>
                        <div class="file-tags">
                          <span class="file-tag lot-tag" *ngIf="f.lotId">Lot: {{ f.lotId }}</span>
                          <span class="file-tag path-tag" *ngIf="f.year || f.month">
                            {{ f.year }}/{{ f.month ? (f.month | number:'2.0-0') : '' }}
                          </span>
                        </div>
                      </div>
                    </div>
                    <span class="file-size-badge">{{ formatBytes(f.sizeBytes || 0) }}</span>
                  </div>

                  <div class="preview-more-banner" *ngIf="selectedFiles().length > 15">
                    <span>And {{ selectedFiles().length - 15 }} more files will be included in the session...</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="pane-footer mt-6">
            <app-glass-button variant="secondary" (clicked)="prevStep()">Back</app-glass-button>
            <app-glass-button variant="primary" [loading]="executing()" (clicked)="executeReload()">
              Dispatch Reload Session 🚀
            </app-glass-button>
          </div>
        </div>

        <!-- STEP 4: MONITORING -->
        <div *ngIf="currentStep() === 4" class="step-pane animate-in">
          <div class="pane-header">
            <h3>Step 4: <span class="accent">Execution Monitor</span></h3>
            <p>Live tracking of the archival reload process. You can navigate away; the process will continue in the background.</p>
          </div>

          <div class="monitor-container">
            <app-xfcs-session-monitor 
              [sessionId]="sessionId()" 
              (sessionCompleted)="onSessionDone($event)">
            </app-xfcs-session-monitor>

            <div class="file-tracker mt-4">
              <app-xfcs-file-monitor
                [sessionId]="sessionId()"
                [autoRefresh]="true"
                [autoRefreshMs]="3000"
                [embedded]="true">
              </app-xfcs-file-monitor>
            </div>
          </div>

          <div class="pane-footer mt-6">
            <app-glass-button variant="secondary" routerLink="/dashboard">Return to Dashboard</app-glass-button>
            <app-glass-button variant="primary" routerLink="/history">View all Sessions</app-glass-button>
          </div>
        </div>
      </main>
    </div>
  `,
  styles: [`
    .stepper-root {
      width: min(100%, 1320px);
      margin: 0 auto;
      padding: 0.5rem 1rem 1.25rem;
      box-sizing: border-box;
    }
    .stepper-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem; gap: 2rem; }
    .stepper-header h1 { margin: 0; font-size: 1.8rem; letter-spacing: -0.02em; }
    .subtitle { margin: 0.25rem 0 0 0; color: var(--text-muted); font-size: 0.9rem; }

    .stepper-progress { display: flex; align-items: center; gap: 0.5rem; }
    .step-indicator { display: flex; flex-direction: column; align-items: center; gap: 0.4rem; opacity: 0.4; transition: all 0.3s; }
    .step-indicator.active { opacity: 1; }
    .step-indicator.completed { color: var(--success); opacity: 0.8; }
    .step-num { width: 28px; height: 28px; border-radius: 50%; border: 2px solid currentColor; display: grid; place-items: center; font-size: 0.75rem; font-weight: 700; }
    .step-label { font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }
    .step-connector { width: 40px; height: 2px; background: rgba(255, 255, 255, 0.1); margin-top: -12px; }
    .step-indicator.completed .step-num { background: var(--success); color: #fff; border-color: var(--success); }

    .stepper-content { padding: 2rem; min-height: 400px; position: relative; }
 
    /* LOADING OVERLAY */
    .loading-overlay {
      position: absolute;
      inset: 0;
      background: rgba(15, 12, 41, 0.6);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      z-index: 100;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: inherit;
    }
    .spinner-box { display: flex; flex-direction: column; align-items: center; gap: 1rem; }
    .glass-spinner {
      width: 48px;
      height: 48px;
      border: 3px solid rgba(129, 140, 248, 0.2);
      border-top-color: var(--accent-color);
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }
    .loading-msg { margin: 0; font-weight: 700; color: var(--accent-color); letter-spacing: 0.05em; text-transform: uppercase; font-size: 0.8rem; }
    @keyframes spin { to { transform: rotate(360deg); } }
 
    .pane-header { margin-bottom: 2rem; }
    .pane-header h3 { margin: 0 0 0.5rem 0; font-size: 1.4rem; }
    .pane-header p { margin: 0; color: var(--text-muted); line-height: 1.5; }

    .form-container { display: flex; flex-direction: column; gap: 1.5rem; }
    
    /* Filter Row Styles */
    .filter-row { 
      display: grid; 
      grid-template-columns: repeat(3, 1fr); 
      gap: 1rem; 
    }
    
    @media (max-width: 768px) {
      .filter-row { 
        grid-template-columns: 1fr; 
      }
    }

    /* Resolved environment bar */
    .env-resolved-bar {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      padding: 0.75rem 1rem;
      border-radius: 12px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      background: rgba(255, 255, 255, 0.02);
      font-size: 0.85rem;
      transition: all 0.3s ease;
      min-height: 48px;
    }
    .env-resolved-bar.is-resolved {
      border-color: rgba(16, 185, 129, 0.35);
      background: rgba(16, 185, 129, 0.06);
    }
    .resolved-icon { font-size: 1.1rem; color: #10b981; }
    .resolved-label { color: var(--text-muted); font-weight: 600; text-transform: uppercase; font-size: 0.7rem; letter-spacing: 0.05em; }
    .resolved-env { color: #fff; font-weight: 700; font-family: monospace; font-size: 0.95rem; }
    .pending-icon { font-size: 1.1rem; color: var(--text-muted); opacity: 0.5; }
    .pending-label { color: var(--text-muted); font-style: italic; font-size: 0.85rem; }

    .pane-footer { display: flex; justify-content: flex-end; gap: 1rem; border-top: 1px solid rgba(255, 255, 255, 0.05); padding-top: 1.5rem; }
    .pane-footer.split { justify-content: space-between; }
    .search-footer-right { display: flex; align-items: center; gap: 1rem; }
    .precheck-toggle {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.82rem;
      color: var(--text-muted);
      cursor: pointer;
      user-select: none;
      white-space: nowrap;
    }
    .precheck-toggle input[type="checkbox"] {
      accent-color: var(--accent-color);
      width: 14px;
      height: 14px;
      cursor: pointer;
    }
    .monitor-container { display: flex; flex-direction: column; gap: 1rem; }
    .file-tracker { width: 100%; }

    .mt-4 { margin-top: 1rem; }
    .mt-6 { margin-top: 1.5rem; }

    /* Display-limit banner */
    .display-limit-banner {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.75rem 1rem;
      border-radius: 10px;
      border: 1px solid rgba(251, 191, 36, 0.3);
      background: rgba(251, 191, 36, 0.07);
      color: #fbbf24;
      font-size: 0.82rem;
      margin-bottom: 0.75rem;
      flex-wrap: wrap;
      .material-icons { font-size: 1.1rem; flex-shrink: 0; }
      span { flex: 1; min-width: 0; }
    }

    /* LOT STATS PANEL */
    .lot-stats-panel {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      padding: 1.5rem;
      border-radius: 12px;
      border: 1px solid rgba(129, 140, 248, 0.2);
      background: rgba(30, 24, 64, 0.6);
      margin-bottom: 1.5rem;
    }
    .stats-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .stats-title {
      margin: 0;
      font-size: 0.95rem;
      font-weight: 600;
      color: var(--accent-color);
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 1rem;
    }
    .stat-item {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      padding: 0.75rem 1rem;
      border-radius: 10px;
      border: 1px solid rgba(167, 139, 250, 0.15);
      background: rgba(30, 24, 64, 0.5);
    }
    .stat-label {
      font-size: 0.7rem;
      font-weight: 600;
      color: var(--text-muted);
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }
    .stat-value {
      font-size: 1.4rem;
      font-weight: 700;
      color: #fff;
    }
    .stat-value.found {
      color: #10b981;
    }
    .stat-value.warning {
      color: #f59e0b;
    }

    .not-found-section {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      padding-top: 1rem;
      border-top: 1px solid rgba(255, 255, 255, 0.05);
    }
    .not-found-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
    }
    .btn-collapse {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      background: transparent;
      border: none;
      color: var(--text-muted);
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
      padding: 0;
      transition: color 0.2s;
    }
    .btn-collapse .material-icons {
      font-size: 1.1rem;
    }
    .btn-collapse:hover {
      color: var(--accent-color);
    }
    .not-found-list {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      animation: slideDown 0.2s ease-out;
    }
    .lot-item {
      display: flex;
      align-items: center;
    }
    .lot-badge {
      display: inline-flex;
      align-items: center;
      padding: 0.35rem 0.7rem;
      background: rgba(251, 146, 60, 0.15);
      border: 1px solid rgba(251, 146, 60, 0.3);
      border-radius: 6px;
      color: #fb923c;
      font-size: 0.8rem;
      font-weight: 600;
      font-family: monospace;
      letter-spacing: 0.02em;
      white-space: nowrap;
    }

    .env-meta-grid {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 0.75rem;
    }
    .env-meta-chip {
      display: flex;
      flex-direction: column;
      gap: 0.3rem;
      padding: 0.75rem 1rem;
      border-radius: 14px;
      border: 1px solid rgba(255, 255, 255, 0.06);
      background: rgba(255, 255, 255, 0.02);
      min-height: 56px;
      justify-content: center;
      transition: border-color 0.3s ease, background 0.3s ease;
    }
    .has-env .env-meta-chip {
      border-color: rgba(129, 140, 248, 0.2);
      background: rgba(129, 140, 248, 0.04);
    }
    .meta-label {
      font-size: 0.6875rem;
      font-weight: 600;
      color: var(--text-muted);
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }
    .has-env .meta-label { color: var(--accent-color); opacity: 0.7; }
    .meta-value {
      font-size: 0.9375rem;
      font-weight: 500;
      color: #fff;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .meta-value.empty { color: var(--text-muted); font-style: italic; font-size: 0.85rem; }

    @media (max-width: 900px) {
      .env-meta-grid { grid-template-columns: 1fr; }
    }

    .search-rows-container { display: flex; flex-direction: column; gap: 0.75rem; }

    /* Disabled state when no environment selected */
    .search-rows-container.rows-disabled {
      position: relative;
    }
    .disabled-overlay {
      position: absolute;
      inset: 0;
      z-index: 10;
      border-radius: 12px;
      background: rgba(15, 23, 42, 0.55);
      backdrop-filter: blur(2px);
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      color: var(--text-muted);
      font-size: 0.85rem;
      font-weight: 600;
      letter-spacing: 0.02em;
      pointer-events: none;
      .material-icons { font-size: 1.1rem; opacity: 0.6; }
    }
    .rows-disabled .search-row,
    .rows-disabled .btn-add-row {
      opacity: 0.35;
      pointer-events: none;
      filter: grayscale(0.4);
    }

    .search-row { display: flex; flex-direction: column; gap: 0.5rem; padding: 0.75rem; border-radius: 12px; border: 1px solid rgba(167, 139, 250, 0.2); background: rgba(30, 24, 64, 0.45); }
    .row-header { display: flex; justify-content: space-between; align-items: center; }
    .row-header-actions { display: flex; align-items: center; gap: 0.4rem; }
    .row-title { font-size: 0.75rem; font-weight: 700; color: var(--accent-color); text-transform: uppercase; letter-spacing: 0.05em; }
    .btn-remove { background: transparent; border: none; color: var(--text-muted); padding: 0.2rem; cursor: pointer; border-radius: 50%; display: flex; align-items: center; justify-content: center; transition: all 0.2s; }
    .btn-remove:hover { background: rgba(239, 68, 68, 0.15); color: #ef4444; }
    .btn-clear-lots { display: flex; align-items: center; gap: 0.3rem; background: transparent; border: 1px solid rgba(167, 139, 250, 0.25); border-radius: 6px; color: var(--text-muted); font-size: 0.7rem; font-weight: 600; padding: 0.2rem 0.5rem; cursor: pointer; transition: all 0.2s; }
    .btn-clear-lots:hover { background: rgba(167, 139, 250, 0.12); color: var(--accent-color); border-color: rgba(167, 139, 250, 0.5); }
    .row-pickers { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; }
    .row-textarea { display: flex; flex-direction: column; gap: 0.25rem; }
    .floating-label { font-size: 0.6875rem; font-weight: 600; color: var(--text-muted); letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 2px; }

    /* LOT CHIP INPUT */
    .lot-chip-input {
      min-height: 56px;
      padding: 0.5rem 0.75rem;
      border-radius: 14px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      background: rgba(255, 255, 255, 0.03);
      display: flex;
      flex-wrap: wrap;
      align-items: flex-start;
      gap: 0.4rem;
      cursor: text;
      transition: border-color 0.2s ease, box-shadow 0.2s ease;
      box-sizing: border-box;
    }
    .lot-chip-input.focused {
      border-color: var(--accent-color);
      box-shadow: 0 0 0 2px rgba(129, 140, 248, 0.2);
    }
    .chip-list {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.35rem;
      width: 100%;
    }
    .lot-chip {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      padding: 0.2rem 0.5rem 0.2rem 0.65rem;
      background: rgba(129, 140, 248, 0.18);
      border: 1px solid rgba(129, 140, 248, 0.35);
      border-radius: 6px;
      color: var(--accent-color);
      font-size: 0.8rem;
      font-weight: 600;
      font-family: monospace;
      letter-spacing: 0.02em;
      white-space: nowrap;
    }
    .chip-remove {
      background: none;
      border: none;
      color: rgba(129, 140, 248, 0.6);
      cursor: pointer;
      font-size: 1rem;
      line-height: 1;
      padding: 0;
      display: flex;
      align-items: center;
      transition: color 0.15s;
      &:hover { color: #f87171; }
    }
    .chip-native-input {
      flex: 1;
      min-width: 160px;
      background: transparent;
      border: none;
      outline: none;
      color: #fff;
      font-size: 0.9rem;
      font-family: inherit;
      padding: 0.25rem 0;
      &::placeholder { color: rgba(255,255,255,0.25); font-size: 0.85rem; }
    }
    .lot-count-hint {
      font-size: 0.72rem;
      color: var(--accent-color);
      opacity: 0.7;
      padding-left: 0.25rem;
    }
    .lot-rejected-hint {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      font-size: 0.75rem;
      color: #f87171;
      padding-left: 0.25rem;
      animation: slideDown 0.2s ease-out;
      .material-icons { font-size: 0.9rem; flex-shrink: 0; }
      strong { font-weight: 700; font-family: monospace; }
    }
    @keyframes slideDown {
      from { opacity: 0; transform: translateY(-4px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .btn-add-row { display: flex; align-items: center; justify-content: center; gap: 0.5rem; padding: 0.5rem; border-radius: 10px; border: 1px dashed rgba(167, 139, 250, 0.3); background: transparent; color: var(--text-muted); font-size: 0.8rem; font-weight: 600; cursor: pointer; }

    /* REVIEW STYLES */
    .review-summary { display: flex; flex-direction: column; gap: 1rem; background: rgba(255,255,255,0.03); padding: 1.5rem; border-radius: 12px; border: 1px solid rgba(255,255,255,0.05); }
    .summary-item { display: flex; justify-content: space-between; align-items: center; }
    .summary-item .label { color: var(--text-muted); font-size: 0.9rem; }
    .summary-item .value { font-weight: 600; font-size: 1.1rem; }
    .divider { border: 0; border-top: 1px solid rgba(255,255,255,0.05); margin: 0.5rem 0; }
    .file-preview-list { display: flex; flex-direction: column; gap: 0.4rem; max-height: 200px; overflow-y: auto; }
    .preview-file { display: flex; align-items: center; gap: 0.5rem; font-size: 0.8rem; color: var(--text-muted); }
    .preview-more { font-size: 0.75rem; font-style: italic; color: var(--accent-color); margin-top: 0.5rem; }

    /* EMPTY STATE */
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 3.5rem 2rem;
      gap: 1.25rem;
      text-align: center;
      animation: fadeInUp 0.4s ease-out;
    }
    .empty-icon-wrap {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 80px;
      height: 80px;
    }
    .empty-icon {
      font-size: 2.5rem;
      color: var(--accent-color);
      opacity: 0.6;
      position: relative;
      z-index: 1;
    }
    .empty-icon-ring {
      position: absolute;
      inset: 0;
      border-radius: 50%;
      border: 2px solid rgba(129, 140, 248, 0.2);
      background: rgba(129, 140, 248, 0.06);
      animation: pulse-ring 2.5s ease-in-out infinite;
    }
    @keyframes pulse-ring {
      0%, 100% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.08); opacity: 0.6; }
    }
    .empty-title {
      margin: 0;
      font-size: 1.2rem;
      font-weight: 700;
      color: var(--text-main, #fff);
      letter-spacing: -0.01em;
    }
    .empty-body {
      margin: 0;
      font-size: 0.9rem;
      color: var(--text-muted);
      line-height: 1.6;
      max-width: 440px;
    }
    .empty-suggestions {
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
      width: 100%;
      max-width: 420px;
      padding: 1rem 1.25rem;
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.05);
    }
    .suggestion-item {
      display: flex;
      align-items: flex-start;
      gap: 0.65rem;
      font-size: 0.82rem;
      color: var(--text-muted);
      text-align: left;
      line-height: 1.5;
      .material-icons { font-size: 1rem; color: var(--accent-color); opacity: 0.6; flex-shrink: 0; margin-top: 1px; }
    }

    .animate-in { animation: fadeInUp 0.4s ease-out; }
    @keyframes fadeInUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }

    /* STEP 3: REVIEW & CONFIRM PANEL */
    .review-layout {
      display: grid;
      grid-template-columns: 360px 1fr;
      gap: 1.5rem;
      align-items: start;
    }
    @media (max-width: 960px) {
      .review-layout {
        grid-template-columns: 1fr;
      }
    }
    
    .glass-card {
      border-radius: 16px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      background: rgba(30, 24, 64, 0.4);
      padding: 1.5rem;
      box-shadow: 0 8px 32px rgba(15, 12, 41, 0.25);
    }
    body.light-theme .glass-card {
      border-color: rgba(99, 102, 241, 0.15);
      background: rgba(255, 255, 255, 0.6);
      box-shadow: 0 8px 32px rgba(99, 102, 241, 0.05);
    }

    .card-header {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      margin-bottom: 1.25rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      padding-bottom: 0.75rem;
    }
    body.light-theme .card-header {
      border-bottom-color: rgba(99, 102, 241, 0.1);
    }
    .card-header h4 {
      margin: 0;
      font-size: 0.95rem;
      font-weight: 700;
      color: #fff;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    body.light-theme .card-header h4 {
      color: var(--text-main);
    }
    .accent-icon {
      color: var(--accent-color);
    }

    .meta-rows {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    .meta-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 1rem;
    }
    .meta-label {
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .meta-value {
      font-size: 0.9rem;
      font-weight: 600;
      color: #fff;
    }
    body.light-theme .meta-value {
      color: var(--text-main);
    }
    .meta-value.highlight {
      color: var(--accent-color);
      font-size: 1rem;
      font-weight: 700;
    }
    .meta-value.env-pill {
      background: rgba(129, 140, 248, 0.15);
      border: 1px solid rgba(129, 140, 248, 0.3);
      padding: 0.25rem 0.6rem;
      border-radius: 6px;
      color: var(--accent-color);
      font-family: monospace;
    }

    .precheck-status-box {
      margin-top: 1.5rem;
      padding-top: 1.25rem;
      border-top: 1px solid rgba(255, 255, 255, 0.06);
    }
    body.light-theme .precheck-status-box {
      border-top-color: rgba(99, 102, 241, 0.1);
    }
    .status-indicator {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.75rem 1rem;
      border-radius: 10px;
      font-size: 0.8rem;
      font-weight: 600;
    }
    .status-indicator.success {
      background: rgba(16, 185, 129, 0.1);
      border: 1px solid rgba(16, 185, 129, 0.2);
      color: #10b981;
    }
    .status-indicator.warning {
      background: rgba(245, 158, 11, 0.1);
      border: 1px solid rgba(245, 158, 11, 0.2);
      color: #fbbf24;
    }

    .safety-notice {
      display: flex;
      gap: 0.75rem;
      padding: 1rem 1.25rem;
      border-radius: 12px;
      border: 1px solid rgba(167, 139, 250, 0.15);
      background: rgba(167, 139, 250, 0.05);
      color: var(--text-muted);
      margin-top: 1rem;
      align-items: flex-start;
    }
    .safety-notice .material-icons {
      color: var(--accent-color);
      margin-top: 2px;
    }
    .notice-text h5 {
      margin: 0 0 0.25rem 0;
      font-size: 0.8rem;
      font-weight: 700;
      color: #fff;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    body.light-theme .notice-text h5 {
      color: var(--text-main);
    }
    .notice-text p {
      margin: 0;
      font-size: 0.75rem;
      line-height: 1.4;
    }

    /* RIGHT FILE LIST CARD */
    .file-list-card {
      max-height: 480px;
      display: flex;
      flex-direction: column;
    }
    .file-preview-list {
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
      overflow-y: auto;
      padding-right: 0.5rem;
      max-height: 380px;
    }
    /* Custom Scrollbar for list */
    .file-preview-list::-webkit-scrollbar {
      width: 6px;
    }
    .file-preview-list::-webkit-scrollbar-track {
      background: rgba(255, 255, 255, 0.02);
      border-radius: 3px;
    }
    .file-preview-list::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.15);
      border-radius: 3px;
    }
    .file-preview-list::-webkit-scrollbar-thumb:hover {
      background: rgba(255, 255, 255, 0.25);
    }
    body.light-theme .file-preview-list::-webkit-scrollbar-thumb {
      background: rgba(99, 102, 241, 0.2);
    }

    .preview-file-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.6rem 0.8rem;
      border-radius: 10px;
      border: 1px solid rgba(255, 255, 255, 0.04);
      background: rgba(255, 255, 255, 0.01);
      transition: all 0.2s ease;
      gap: 1.5rem;
    }
    .preview-file-item:hover {
      border-color: rgba(129, 140, 248, 0.2);
      background: rgba(129, 140, 248, 0.03);
    }
    body.light-theme .preview-file-item {
      border-color: rgba(99, 102, 241, 0.05);
      background: rgba(99, 102, 241, 0.02);
    }
    body.light-theme .preview-file-item:hover {
      border-color: rgba(99, 102, 241, 0.15);
      background: rgba(99, 102, 241, 0.05);
    }

    .file-info-group {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      min-width: 0;
      flex: 1;
    }
    .file-icon {
      color: var(--accent-color);
      opacity: 0.8;
      flex-shrink: 0;
    }
    .file-details {
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
      min-width: 0;
    }
    .file-name {
      font-size: 0.825rem;
      font-weight: 500;
      color: #fff;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      font-family: monospace;
    }
    body.light-theme .file-name {
      color: var(--text-main);
    }
    .file-tags {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      flex-wrap: wrap;
    }
    .file-tag {
      font-size: 0.65rem;
      font-weight: 700;
      padding: 0.1rem 0.35rem;
      border-radius: 4px;
      text-transform: uppercase;
      letter-spacing: 0.02em;
    }
    .lot-tag {
      background: rgba(129, 140, 248, 0.15);
      color: var(--accent-color);
      border: 1px solid rgba(129, 140, 248, 0.2);
    }
    .path-tag {
      background: rgba(255, 255, 255, 0.05);
      color: var(--text-muted);
      border: 1px solid rgba(255, 255, 255, 0.05);
    }
    body.light-theme .path-tag {
      background: rgba(15, 23, 42, 0.05);
      color: var(--text-muted);
      border-color: rgba(15, 23, 42, 0.05);
    }

    .file-size-badge {
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--text-muted);
      white-space: nowrap;
      font-family: monospace;
    }

    .preview-more-banner {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0.75rem;
      border-radius: 8px;
      background: rgba(129, 140, 248, 0.05);
      border: 1px dashed rgba(129, 140, 248, 0.2);
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--accent-color);
      text-align: center;
    }

    @media (max-width: 768px) {
      .stepper-header { flex-direction: column; align-items: flex-start; }
      .stepper-progress { width: 100%; justify-content: space-between; }
    }
  `]
})
export class XfcsStepperComponent implements OnInit {
  // Helper for human-readable file sizes
  formatBytes(bytes: number, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }

  currentStep = signal<number>(1);
  environment = signal<string>('');
  searchRows = signal<SearchRow[]>([{ id: 1, lotsRaw: '', lots: [], rejectedLots: [] }]);
  envs = signal<EnvYearRange[]>([]);

  // Filter signals (default to empty string = "All")
  filterSite = signal<string>('');
  filterArea = signal<string>('');
  filterTesterType = signal<string>('');

  // Pre-check signals (8.1)
  private readonly PRECHECK_STORAGE_KEY = 'xfcs.precheck.enabled';
  preChecking     = signal<boolean>(false);
  preCheckResult  = signal<ExensioPreCheckResponse | null>(null);
  preCheckStale   = signal<boolean>(false);
  showPreCheckDlg = signal<boolean>(false);
  preCheckEnabled = signal<boolean>(
    (() => {
      const stored = localStorage.getItem('xfcs.precheck.enabled');
      return stored === null ? true : stored === 'true';
    })()
  );

  // Candidate environments after all 3 filters applied — used for auto-resolve + disambiguation
  resolvedEnvs = computed<EnvYearRange[]>(() => {
    const all = this.envs();
    const site = this.filterSite();
    const area = this.filterArea();
    const type = this.filterTesterType();
    if (!site && !area && !type) return [];
    return all.filter(e =>
      (!site || e.siteName === site) &&
      (!area || e.areaCode === area) &&
      (!type || e.testerType === type)
    );
  });

  // Auto-set environment when exactly one match; clear when filters change and current env no longer matches
  resolveStatus = computed<'none' | 'resolved' | 'ambiguous'>(() => {
    const candidates = this.resolvedEnvs();
    const site = this.filterSite();
    const area = this.filterArea();
    const type = this.filterTesterType();
    if (!site || !area || !type) return 'none';
    if (candidates.length === 1) return 'resolved';
    if (candidates.length > 1) return 'ambiguous';
    return 'none';
  });

  // Site options: all distinct siteName values from full env list
  siteOptions = computed<GlassOption[]>(() => {
    const sites = [...new Set(this.envs().map(e => e.siteName).filter((v): v is string => Boolean(v)))].sort();
    return sites.map(s => ({ value: s, label: s }));
  });

  // Flat options for the disambiguation select (when multiple envs match)
  resolvedEnvOptions = computed<GlassOption[]>(() =>
    this.resolvedEnvs().map(e => ({ value: e.environment, label: e.environment }))
  );

  // Area options: narrowed by selected site
  areaOptions = computed<GlassOption[]>(() => {
    const base = this.filterSite()
      ? this.envs().filter(e => e.siteName === this.filterSite())
      : this.envs();
    const areas = [...new Set(base.map(e => e.areaCode).filter((v): v is string => Boolean(v)))].sort();
    return areas.map(a => ({ value: a, label: a }));
  });

  // Tester type options: narrowed by selected site + area
  testerTypeOptions = computed<GlassOption[]>(() => {
    const base = this.envs().filter(e =>
      (!this.filterSite() || e.siteName === this.filterSite()) &&
      (!this.filterArea() || e.areaCode === this.filterArea())
    );
    const types = [...new Set(base.map(e => e.testerType).filter((v): v is string => Boolean(v)))].sort();
    return types.map(t => ({ value: t, label: t }));
  });

  // Derived metadata from the selected environment — read-only, no user interaction
  selectedEnvInfo = computed(() =>
    this.envs().find((e: EnvYearRange) => e.environment === this.environment()) ?? null
  );
  
  // Search Results State
  // allSearchResults holds the full de-duplicated result set returned by the backend.
  // searchResults holds the display-capped slice shown in the results table.
  allSearchResults = signal<SearchResult[]>([]);
  searchResults = signal<SearchResult[]>([]);
  displayLimited = signal<boolean>(false);   // true when results are capped for display
  selectedFiles = signal<SearchResult[]>([]);
  selectedFilePaths = computed(() =>
    this.selectedFiles()
      .map((f: SearchResult): string => f.path)
      .filter((p: string): boolean => !!p && p.trim().length > 0)
  );

  // Lot Statistics (computed from search rows and results)
  // Uses allSearchResults so stats reflect the full result set, not just what is displayed.
  lotStats = computed(() => {
    // Collect all unique entered lots from all search rows
    const enteredLots = new Set<string>();
    for (const row of this.searchRows()) {
      for (const lot of row.lots) {
        enteredLots.add(lot);
      }
      // Also parse lotsRaw if there's any unparsed content
      const rawTokens = row.lotsRaw
        .split(/[,;\n\s]+/)
        .map(t => t.trim().toUpperCase())
        .filter(t => t.length >= this.MIN_LOT_LENGTH);
      for (const token of rawTokens) {
        enteredLots.add(token);
      }
    }

    // Collect all unique found lots from the full result set (uppercased for case-insensitive match)
    const foundLots = new Set<string>();
    for (const result of this.allSearchResults()) {
      const lotId = result.userLotId || result.lotId;
      if (lotId) {
        foundLots.add(lotId.toUpperCase());
      }
    }

    // Compute not-found lots (enteredLots is already uppercased)
    const notFoundLots: string[] = Array.from(enteredLots).filter(lot => !foundLots.has(lot));

    return {
      totalEntered: enteredLots.size,
      totalFound: foundLots.size,
      totalNotFound: notFoundLots.length,
      notFoundLots: notFoundLots.sort()
    };
  });
  
  // Execution State
  sessionId = signal<string>('');
  searching = signal<boolean>(false);
  executing = signal<boolean>(false);
  downloading = signal<boolean>(false);
  executionTerminalStatus = signal<string>('');

  focusedRowId = signal<number | null>(null);
  showNotFoundList = signal<boolean>(false);
  private rowIdCounter = 1;

  constructor(
    private api: XfcsApiService, 
    private toast: ToastService,
    private router: Router
  ) {}

  ngOnInit() {
    this.api.getEnvs().subscribe(res => this.envs.set(res));
  }

  // selection helpers
  canSearch(): boolean {
    return this.environment() !== '' && this.searchRows().some(r => r.lots.length > 0 || r.lotsRaw.trim() !== '');
  }

  performSearch() {
    this.searching.set(true);

    // Non-blocking UX: only show a warning if year/month aren't specified.
    // Backend pruning is most effective when at least `year` (and often `month`) are provided.
    const activeRows = this.searchRows().filter(r => r.lots.length > 0 || r.lotsRaw.trim() !== '');
    const anyYear = activeRows.some(r => r.year != null);
    const anyMonth = activeRows.some(r => r.month != null);
    if (!anyYear && !anyMonth) {
      this.toast.warning('No Year/Month selected. Search may be slower.');
    } else if (!anyYear && anyMonth) {
      this.toast.warning('Year not selected. Search may be slower (month filtering will still apply).');
    }

    const selectedEnv = this.envs().find(e => e.environment === this.environment());
    const site = selectedEnv?.siteName ?? '';
    const area = selectedEnv?.areaCode ?? '';
    const testerType = selectedEnv?.testerType ?? '';

    const requests: Promise<SearchResult[]>[] = this.searchRows()
      .map(row => {
        const lotIds = [
          ...row.lots,
          ...row.lotsRaw.split(/[,;\n\s]+/).map((l: string) => l.trim()).filter((l: string) => l !== '')
        ].filter((v, i, a) => a.indexOf(v) === i) // dedupe
         .filter((v: string) => v.length >= this.MIN_LOT_LENGTH); // enforce min length
        if (!lotIds.length) return null;

        const years = row.year ? [row.year] : undefined;
        const months = row.month ? [row.month] : undefined;

        return firstValueFrom(
          this.api.searchArchive({
            environment: this.environment(),
            site,
            area,
            testerType,
            years,
            months,
            lotIds
          }).pipe(
            catchError(() => of({ results: [], totalFound: 0, maxResults: 0, displayLimit: 500, limitExceeded: false, displayLimited: false }))
          )
        ).then((response: any) => {
          // Handle both old SearchResult[] and new SearchResponse formats
          const results = Array.isArray(response) ? response : (response.results || []);
          const dl: number = response.displayLimit ?? results.length;
          const wasDisplayLimited: boolean = !!response.displayLimited || results.length > dl;
          
          // Show warning if hard search limit was exceeded
          if (response.limitExceeded) {
            this.toast.warning(
              `Search results limited to ${response.maxResults} files. ` +
              `Total matching: ${response.totalFound}. ` +
              `Try narrowing your search criteria.`
            );
          }
          
          return (results as SearchResult[]).map((r: SearchResult) => ({
            ...r,
            // Trust the backend's matched lotId; only fall back to lotIds[0] if truly absent.
            userLotId: r.lotId || lotIds[0],
            _displayLimit: dl,
            _displayLimited: wasDisplayLimited
          } as any));
        });
      })
      .filter((x: Promise<SearchResult[]> | null): x is Promise<SearchResult[]> => x !== null);

    if (requests.length === 0) {
      this.toast.error('Please enter at least one valid Lot ID');
      this.searching.set(false);
      return;
    }

    Promise.all(requests).then((resArrays: SearchResult[][]) => {
      const allResults: SearchResult[] = resArrays.flat().filter((r: SearchResult) => r !== null && r !== undefined);
      const uniquePaths = new Set<string>();
      const finalResults: SearchResult[] = [];

      for (const r of allResults) {
        if (!uniquePaths.has(r.path)) {
          uniquePaths.add(r.path);
          finalResults.push(r);
        }
      }

      // Determine the effective display limit (use the first result's metadata, or fall back to total count)
      const firstMeta = (allResults[0] as any);
      const displayLimit: number = firstMeta?._displayLimit ?? finalResults.length;

      // Store the full set for processing and stats
      const cleanResults = finalResults.map((r: any) => {
        const { _displayLimit: _dl, _displayLimited: _dlim, ...clean } = r;
        return clean as SearchResult;
      });

      this.allSearchResults.set(cleanResults);

      // Cap what the table renders for UI performance
      const isDisplayLimited = cleanResults.length > displayLimit;
      this.displayLimited.set(isDisplayLimited);
      this.searchResults.set(isDisplayLimited ? cleanResults.slice(0, displayLimit) : cleanResults);

      this.selectedFiles.set([]);
      this.searching.set(false);
      this.nextStep();
    }).catch(() => {
      this.toast.error('Archive search failed');
      this.searching.set(false);
    });
  }

  executeReload() {
    this.executionTerminalStatus.set('');
    this.executing.set(true);
    const env = this.envs().find(e => e.environment === this.environment());
    const filesToProcess = this.getActionableFiles();

    if (filesToProcess.length === 0) {
      this.toast.warning('No files available to reload');
      this.executing.set(false);
      return;
    }

    const req: any = {
      environment: this.environment(),
      site: env?.siteName ?? '',
      area: env?.areaCode ?? '',
      testerType: env?.testerType ?? '',
      filePaths: filesToProcess.map((f: SearchResult) => f.path),
      files: filesToProcess.map((f: SearchResult) => ({
        path: f.path,
        userLotId: f.userLotId || f.lotId
      }))
    };

    this.api.createReload(req).subscribe({
      next: (res: ReloadSession) => {
        this.sessionId.set(res.id);
        this.executing.set(false);
        this.nextStep();
      },
      error: () => {
        this.toast.error('Failed to create reload session');
        this.executing.set(false);
      }
    });
  }

  // Filter change handlers — cascading, auto-resolve
  onFilterSiteChange(value: string): void {
    this.filterSite.set(value);
    // Downstream cascade: clear area/testerType if not valid in new set
    const validAreas = this.areaOptions().map(o => o.value);
    if (!validAreas.includes(this.filterArea())) this.filterArea.set('');
    const validTypes = this.testerTypeOptions().map(o => o.value);
    if (!validTypes.includes(this.filterTesterType())) this.filterTesterType.set('');
    this._autoResolve();
  }

  onFilterAreaChange(value: string): void {
    this.filterArea.set(value);
    const validTypes = this.testerTypeOptions().map(o => o.value);
    if (!validTypes.includes(this.filterTesterType())) this.filterTesterType.set('');
    this._autoResolve();
  }

  onFilterTesterTypeChange(value: string): void {
    this.filterTesterType.set(value);
    this._autoResolve();
  }

  onDisambiguateEnv(value: string): void {
    this.environment.set(value);
  }

  private _autoResolve(): void {
    const candidates = this.resolvedEnvs();
    if (candidates.length === 1) {
      this.environment.set(candidates[0].environment);
    } else {
      // Multiple matches or no matches — clear until user disambiguates
      this.environment.set('');
    }
  }

  async downloadDiscoveredFiles() {
    const files = this.selectedFiles();
    if (files.length === 0) {
      this.toast.warning('Please select at least one file to download');
      return;
    }

    const grouped = this.groupFilesForLotDownloads(files);
    const groups = Array.from(grouped.entries()).filter(([, rows]) => rows.length > 0);
    if (groups.length === 0) {
      this.toast.warning('No valid file paths available for download');
      return;
    }

    this.downloading.set(true);
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
          this.triggerBrowserDownload(blob, filename);
          downloadedGroups += 1;
          downloadedFiles += paths.length;
        } catch {
          hasAnyFailure = true;
        }
      }

      if (downloadedGroups > 0) {
        this.toast.success(`Downloaded ${downloadedFiles} selected file(s) in ${downloadedGroups} archive(s)`);
      } else {
        this.toast.error('Failed to download selected files');
      }

      if (hasAnyFailure && downloadedGroups > 0) {
        this.toast.warning('Some lot groups failed to download');
      }
    } finally {
      this.downloading.set(false);
    }
  }

  // Stepper navigation
  nextStep() { if (this.currentStep() < 4) this.currentStep.update((v: number) => v + 1); }
  prevStep() {
    if (this.currentStep() === 3) {
      // UX requirement: returning from review to discovery resets all selections.
      this.selectedFiles.set([]);
    }
    if (this.currentStep() > 1) this.currentStep.update((v: number) => v - 1);
  }

  onSelectionChanged(files: SearchResult[]) {
    this.selectedFiles.set(files);
  }

  selectAllFiles(): void {
    this.selectedFiles.set(this.allSearchResults());
  }

  private getActionableFiles(): SearchResult[] {
    const selected = this.selectedFiles();
    if (selected.length > 0) return selected;
    return this.allSearchResults();
  }

  private triggerBrowserDownload(blob: Blob, filename: string): void {
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

      // Critical safety: a lot-named download must only contain files that include that same lot token.
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

  totalSelectedSize(): number {
    return this.selectedFiles().reduce((acc: number, f: any) => acc + (f.sizeBytes || 0), 0);
  }

  onSessionDone(status: ReloadStatus) {
    const state = (status?.status ?? '').toLowerCase();
    this.executionTerminalStatus.set(state);

    if (state === 'completed') {
      this.toast.success('Reload session completed successfully!');
      return;
    }

    if (state === 'failed' || state === 'partially_failed') {
      this.toast.warning('Reload session finished with failures.');
      return;
    }

    if (state === 'cancelled') {
      this.toast.warning('Reload session was cancelled.');
    }
  }

  isStep4Completed(): boolean {
    return this.executionTerminalStatus() === 'completed';
  }

  resetAll(): void {
    this.environment.set('');
    this.filterSite.set('');
    this.filterArea.set('');
    this.filterTesterType.set('');
    this.rowIdCounter = 1;
    this.searchRows.set([{ id: 1, lotsRaw: '', lots: [], rejectedLots: [] }]);
    this.allSearchResults.set([]);
    this.searchResults.set([]);
    this.displayLimited.set(false);
    this.selectedFiles.set([]);
    this.executionTerminalStatus.set('');
    this.preCheckResult.set(null);
    this.preCheckStale.set(false);
    this.showPreCheckDlg.set(false);
  }

  clearBlockLots(id: number): void {
    this.searchRows.update((rows: SearchRow[]) =>
      rows.map((r: SearchRow) => r.id === id ? { ...r, lots: [], lotsRaw: '' } : r)
    );
  }

  buildNotFoundCsv(lots: string[]): string {
    const lines = ['lot_id'];
    for (const lot of lots) {
      lines.push(lot);
    }
    return lines.join('\n');
  }

  exportNotFoundCsv(): void {
    const notFound = this.lotStats().notFoundLots;
    if (notFound.length === 0) {
      this.toast.warning('No lots to export');
      return;
    }

    const csv = this.buildNotFoundCsv(notFound);
    const now = new Date();
    const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
    const filename = `lots-not-found-${ts}.csv`;

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    this.triggerBrowserDownload(blob, filename);
    this.toast.success(`Exported ${notFound.length} lot(s) to ${filename}`);
  }

  toggleNotFoundList(): void {
    this.showNotFoundList.update(v => !v);
  }

  // Pre-check handlers
  onPreCheckToggle(enabled: boolean): void {
    this.preCheckEnabled.set(enabled);
    localStorage.setItem(this.PRECHECK_STORAGE_KEY, String(enabled));
  }

  buildPreCheckRequest(): ExensioPreCheckRequest {
    const allLots = new Set<string>();
    const blocks = this.searchRows().map(row => {
      row.lots.forEach(l => allLots.add(l));
      return { year: row.year, month: row.month, lots: [...row.lots] };
    });
    return { environment: this.environment(), lotIds: [...allLots], blocks };
  }

  async onSearchClick(): Promise<void> {
    if (!this.canSearch()) return;
    if (!this.preCheckEnabled()) {
      this.performSearch();
      return;
    }
    this.preChecking.set(true);
    try {
      const req = this.buildPreCheckRequest();
      const result = await firstValueFrom(
        this.api.runExensioPreCheck(req).pipe(catchError(() => of(null)))
      );
      this.preCheckResult.set(result);
      this.preCheckStale.set(false);
      if (result && !result.error && result.lotsFound.length > 0) {
        this.showPreCheckDlg.set(true);
        return;
      }
      if (result?.error) {
        console.warn('[PreCheck] Soft failure:', result.error);
      }
    } catch {
      // soft failure — proceed to archive search
    } finally {
      this.preChecking.set(false);
    }
    this.performSearch();
  }

  onPreCheckProceed(): void {
    this.showPreCheckDlg.set(false);
    this.performSearch();
  }

  onPreCheckGoBack(): void {
    this.showPreCheckDlg.set(false);
  }

  // Row Management
  addRow() { this.searchRows.update((rows: SearchRow[]) => [...rows, { id: ++this.rowIdCounter, lotsRaw: '', lots: [], rejectedLots: [] }]); }
  removeRow(id: number) { this.searchRows.update((rows: SearchRow[]) => rows.filter((r: SearchRow) => r.id !== id)); }
  updateRow(id: number, field: keyof SearchRow, value: any) {
    if (this.preCheckResult() !== null) {
      this.preCheckStale.set(true);
    }
    this.searchRows.update((rows: SearchRow[]) => rows.map((r: SearchRow) => r.id === id ? { ...r, [field]: value } : r));
  }

  // Chip input handlers
  private readonly MIN_LOT_LENGTH = 6;

  private addLotsToRow(id: number, raw: string) {
    const tokens = raw.split(/[,;\n\s]+/).map((t: string) => t.trim().toUpperCase()).filter((t: string) => t.length > 0);
    if (!tokens.length) return;

    const valid = tokens.filter((t: string) => t.length >= this.MIN_LOT_LENGTH);
    const rejected = tokens.filter((t: string) => t.length < this.MIN_LOT_LENGTH);

    this.searchRows.update((rows: SearchRow[]) => rows.map((r: SearchRow) => {
      if (r.id !== id) return r;
      const existing = new Set(r.lots);
      valid.forEach((t: string) => existing.add(t));
      // Show rejected briefly — auto-clear after 3s
      const newRejected = rejected.length > 0 ? rejected : r.rejectedLots;
      return { ...r, lots: Array.from(existing), rejectedLots: newRejected };
    }));

    if (rejected.length > 0) {
      setTimeout(() => {
        this.searchRows.update((rows: SearchRow[]) => rows.map((r: SearchRow) =>
          r.id === id ? { ...r, rejectedLots: [] } : r
        ));
      }, 3000);
    }
  }

  removeLot(id: number, lot: string) {
    if (this.preCheckResult() !== null) {
      this.preCheckStale.set(true);
    }
    this.searchRows.update((rows: SearchRow[]) => rows.map((r: SearchRow) =>
      r.id === id ? { ...r, lots: r.lots.filter((l: string) => l !== lot) } : r
    ));
  }

  onLotKeydown(event: KeyboardEvent, id: number) {
    const input = event.target as HTMLInputElement;
    const val = input.value.trim();

    if (event.key === 'Enter' || event.key === ',' || event.key === ' ') {
      event.preventDefault();
      if (val) {
        this.addLotsToRow(id, val);
        input.value = '';
      }
    } else if (event.key === 'Backspace' && !val) {
      this.searchRows.update((rows: SearchRow[]) => rows.map((r: SearchRow) => {
        if (r.id !== id || r.lots.length === 0) return r;
        return { ...r, lots: r.lots.slice(0, -1) };
      }));
    }
  }

  onLotInputBlur(event: FocusEvent, id: number) {
    const input = event.target as HTMLInputElement;
    const val = input.value.trim();
    if (val) {
      this.addLotsToRow(id, val);
      input.value = '';
    }
    this.focusedRowId.set(null);
  }

  onLotPaste(event: ClipboardEvent, id: number) {
    event.preventDefault();
    const text = event.clipboardData?.getData('text') ?? '';
    if (text) {
      this.addLotsToRow(id, text);
      (event.target as HTMLInputElement).value = '';
    }
  }

  // Options

  yearOptions = computed(() => {
    const env = this.envs().find((e: EnvYearRange) => e.environment === this.environment());
    if (!env || !env.startYear || !env.endYear) return [];
    const opts: GlassOption[] = [];
    for (let y = env.endYear; y >= env.startYear; y--) opts.push({ value: y, label: String(y) });
    return opts;
  });

  monthOptions: GlassOption[] = [
    { value: 1, label: 'January' }, { value: 2, label: 'February' },
    { value: 3, label: 'March' }, { value: 4, label: 'April' },
    { value: 5, label: 'May' }, { value: 6, label: 'June' },
    { value: 7, label: 'July' }, { value: 8, label: 'August' },
    { value: 9, label: 'September' }, { value: 10, label: 'October' },
    { value: 11, label: 'November' }, { value: 12, label: 'December' }
  ];
}
