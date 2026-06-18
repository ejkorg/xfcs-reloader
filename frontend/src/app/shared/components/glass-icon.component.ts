import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-glass-icon',
  standalone: true,
  imports: [CommonModule],
  template: `
    <svg 
      [attr.width]="size" 
      [attr.height]="size" 
      [class]="'glass-icon glass-icon-' + color"
      viewBox="0 0 24 24" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg">
      <ng-container [ngSwitch]="name">
        <!-- Search -->
        <g *ngSwitchCase="'search'">
          <circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="2"/>
          <path d="M21 21l-4.35-4.35" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </g>

        <!-- Add/Plus -->
        <g *ngSwitchCase="'add'">
          <path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </g>

        <!-- Person Add -->
        <g *ngSwitchCase="'person_add'">
          <path d="M16 11c1.66 0 3-1.34 3-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3zM8 11c1.66 0 3-1.34 3-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3z" fill="currentColor"/>
          <path d="M16 13c-2.33 0-7 1.17-7 3.5V19h14v-2.5C23 14.17 18.33 13 16 13z" fill="currentColor"/>
          <path d="M8 13c-2.33 0-7 1.17-7 3.5V19h5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          <path d="M20 2v6M17 5h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </g>

        <!-- Verified -->
        <g *ngSwitchCase="'verified'">
          <path d="M12 2l2.3 1.3 2.6-.3 1.3 2.3 2.3 1.3-.3 2.6L22 12l-1.3 2.3.3 2.6-2.3 1.3-1.3 2.3-2.6-.3L12 22l-2.3-1.3-2.6.3-1.3-2.3-2.3-1.3.3-2.6L2 12l1.3-2.3-.3-2.6 2.3-1.3 1.3-2.3 2.6.3L12 2z" stroke="currentColor" stroke-width="2" fill="none"/>
          <path d="M8 12l2.5 2.5L16 9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </g>

        <!-- Key -->
        <g *ngSwitchCase="'vpn_key'">
          <circle cx="8" cy="12" r="3" stroke="currentColor" stroke-width="2"/>
          <path d="M11 12h10M17 12v3M20 12v2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </g>

        <!-- Manage Accounts -->
        <g *ngSwitchCase="'manage_accounts'">
          <circle cx="9" cy="8" r="3" stroke="currentColor" stroke-width="2"/>
          <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          <path d="M16.5 8.5h6M19.5 5.5v6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </g>

        <!-- Close/X -->
        <g *ngSwitchCase="'close'">
          <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </g>

        <!-- Check -->
        <g *ngSwitchCase="'check'">
          <path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </g>

        <!-- Arrow Back -->
        <g *ngSwitchCase="'arrow_back'">
          <path d="M19 12H5M12 19l-7-7 7-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </g>

        <!-- Arrow Forward -->
        <g *ngSwitchCase="'arrow_forward'">
          <path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </g>

        <!-- Upload -->
        <g *ngSwitchCase="'upload'">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </g>

        <!-- Download -->
        <g *ngSwitchCase="'download'">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </g>

        <!-- Edit -->
        <g *ngSwitchCase="'edit'">
          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </g>

        <!-- Delete -->
        <g *ngSwitchCase="'delete'">
          <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </g>

        <!-- More Vertical -->
        <g *ngSwitchCase="'more_vert'">
          <circle cx="12" cy="12" r="1" fill="currentColor"/>
          <circle cx="12" cy="5" r="1" fill="currentColor"/>
          <circle cx="12" cy="19" r="1" fill="currentColor"/>
        </g>

        <!-- More Horizontal -->
        <g *ngSwitchCase="'more_horiz'">
          <circle cx="6" cy="12" r="1.4" fill="currentColor"/>
          <circle cx="12" cy="12" r="1.4" fill="currentColor"/>
          <circle cx="18" cy="12" r="1.4" fill="currentColor"/>
        </g>

        <!-- Refresh -->
        <g *ngSwitchCase="'refresh'">
          <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0118.8-4.3M22 12.5a10 10 0 01-18.8 4.3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </g>

        <!-- Calendar -->
        <g *ngSwitchCase="'calendar'">
          <rect x="3" y="4" width="18" height="18" rx="2" stroke="currentColor" stroke-width="2"/>
          <path d="M16 2v4M8 2v4M3 10h18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </g>

        <!-- Clock -->
        <g *ngSwitchCase="'clock'">
          <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
          <path d="M12 6v6l4 2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </g>

        <!-- Dashboard -->
        <g *ngSwitchCase="'dashboard'">
          <rect x="3" y="3" width="7" height="7" rx="1" stroke="currentColor" stroke-width="2"/>
          <rect x="14" y="3" width="7" height="7" rx="1" stroke="currentColor" stroke-width="2"/>
          <rect x="14" y="14" width="7" height="7" rx="1" stroke="currentColor" stroke-width="2"/>
          <rect x="3" y="14" width="7" height="7" rx="1" stroke="currentColor" stroke-width="2"/>
        </g>

        <!-- People -->
        <g *ngSwitchCase="'people'">
          <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </g>

        <!-- History -->
        <g *ngSwitchCase="'history'">
          <path d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M3 3v5h5M12 7v5l4 2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </g>

        <!-- Settings -->
        <g *ngSwitchCase="'settings'">
          <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/>
          <path d="M12 1v6m0 6v6M4.22 4.22l4.24 4.24m5.08 5.08l4.24 4.24M1 12h6m6 0h6M4.22 19.78l4.24-4.24m5.08-5.08l4.24-4.24" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </g>

        <!-- Info -->
        <g *ngSwitchCase="'info'">
          <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
          <path d="M12 16v-4M12 8h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </g>

        <!-- Warning -->
        <g *ngSwitchCase="'warning'">
          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M12 9v4M12 17h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </g>

        <!-- Error -->
        <g *ngSwitchCase="'error'">
          <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
          <path d="M15 9l-6 6M9 9l6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </g>

        <!-- Success/Check Circle -->
        <g *ngSwitchCase="'check_circle'">
          <path d="M22 11.08V12a10 10 0 11-5.93-9.14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M22 4L12 14.01l-3-3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </g>

        <!-- Cancel -->
        <g *ngSwitchCase="'cancel'">
          <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/>
          <path d="M9 9l6 6M15 9l-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </g>

        <!-- Sort icons -->
        <g *ngSwitchCase="'unfold_more'">
          <path d="M8 9l4-4 4 4M16 15l-4 4-4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </g>
        <g *ngSwitchCase="'arrow_upward'">
          <path d="M12 19V5M6 11l6-6 6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </g>
        <g *ngSwitchCase="'arrow_downward'">
          <path d="M12 5v14M6 13l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </g>

        <!-- Menu -->
        <g *ngSwitchCase="'menu'">
          <path d="M3 12h18M3 6h18M3 18h18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </g>

        <!-- Filter -->
        <g *ngSwitchCase="'filter'">
          <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </g>

        <!-- Sensors -->
        <g *ngSwitchCase="'sensors'">
          <path d="M12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" fill="currentColor"/>
          <path d="M9 9a3 3 0 0 1 6 0M6 6a6 6 0 0 1 12 0M3 3a9 9 0 0 1 18 0M9 15a3 3 0 0 0 6 0M6 18a6 6 0 0 0 12 0M3 21a9 9 0 0 0 18 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </g>

        <!-- Track Changes / Monitor -->
        <g *ngSwitchCase="'track_changes'">
          <circle cx="12" cy="12" r="2" fill="currentColor"/>
          <path d="M12 2a10 10 0 0 1 0 20A10 10 0 0 1 12 2" stroke="currentColor" stroke-width="2" fill="none" stroke-dasharray="4 2"/>
          <path d="M12 6a6 6 0 0 1 0 12A6 6 0 0 1 12 6" stroke="currentColor" stroke-width="2" fill="none"/>
        </g>

        <!-- Monitor Heart / System Status -->
        <g *ngSwitchCase="'monitor_heart'">
          <rect x="2" y="4" width="20" height="14" rx="2" stroke="currentColor" stroke-width="2" fill="none"/>
          <path d="M8 11l2 2 4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M8 20h8M12 18v2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </g>

        <!-- Inventory / Archive box -->
        <g *ngSwitchCase="'inventory_2'">
          <path d="M3 6h18v4H3zM5 10h14v10H5z" stroke="currentColor" stroke-width="2" fill="none" stroke-linejoin="round"/>
          <path d="M10 14h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </g>

        <!-- Lightbulb -->
        <g *ngSwitchCase="'lightbulb'">
          <path d="M9 21h6M12 3a6 6 0 0 1 6 6c0 2.5-1.5 4.5-3 6H9c-1.5-1.5-3-3.5-3-6a6 6 0 0 1 6-6z" stroke="currentColor" stroke-width="2" fill="none" stroke-linejoin="round"/>
        </g>

        <!-- Storage -->
        <g *ngSwitchCase="'storage'">
          <ellipse cx="12" cy="6" rx="9" ry="3" stroke="currentColor" stroke-width="2" fill="none"/>
          <path d="M3 6v6c0 1.66 4.03 3 9 3s9-1.34 9-3V6" stroke="currentColor" stroke-width="2" fill="none"/>
          <path d="M3 12v6c0 1.66 4.03 3 9 3s9-1.34 9-3v-6" stroke="currentColor" stroke-width="2" fill="none"/>
        </g>

        <!-- Timer -->
        <g *ngSwitchCase="'timer'">
          <circle cx="12" cy="13" r="8" stroke="currentColor" stroke-width="2" fill="none"/>
          <path d="M12 9v4l3 3M9 3h6M12 3v2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </g>

        <!-- Pending -->
        <g *ngSwitchCase="'pending'">
          <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" fill="none"/>
          <circle cx="8" cy="12" r="1.2" fill="currentColor"/>
          <circle cx="12" cy="12" r="1.2" fill="currentColor"/>
          <circle cx="16" cy="12" r="1.2" fill="currentColor"/>
        </g>

        <!-- Sync -->
        <g *ngSwitchCase="'sync'">
          <path d="M4 12a8 8 0 0 1 14.93-4M20 12a8 8 0 0 1-14.93 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>
          <path d="M18 4l2 4-4 0M6 20l-2-4 4 0" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </g>

        <!-- Done All / Select All -->
        <g *ngSwitchCase="'done_all'">
          <path d="M18 6L9 15l-4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M22 6L13 15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M8 12l-2 2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </g>

        <!-- Default fallback -->
        <g *ngSwitchDefault>
          <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
        </g>
      </ng-container>
    </svg>
  `,
  styles: [`
    .glass-icon {
      display: inline-block;
      vertical-align: middle;
      transition: all 0.2s ease;
    }

    .glass-icon:hover {
      transform: scale(1.1);
      opacity: 0.9;
    }

    .glass-icon-default {
      color: var(--text-main);
    }

    .glass-icon-primary {
      color: var(--accent-color);
    }

    .glass-icon-success {
      color: #10b981;
    }

    .glass-icon-warning {
      color: #f59e0b;
    }

    .glass-icon-error {
      color: #ef4444;
    }

    .glass-icon-muted {
      color: var(--text-muted);
    }
  `]
})
export class GlassIconComponent {
  @Input() name: string = 'info';
  @Input() size: number = 24;
  @Input() color: 'default' | 'primary' | 'success' | 'warning' | 'error' | 'muted' = 'default';
}
