import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { ToastService } from '../services/toast.service';

@Component({
  selector: 'app-toast-container',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  template: `
    <div class="toast-container">
      @for (toast of toastService.toasts(); track toast.id) {
        <div 
          class="toast glass-panel"
          [class.toast-success]="toast.type === 'success'"
          [class.toast-error]="toast.type === 'error'"
          [class.toast-info]="toast.type === 'info'"
          [class.toast-warning]="toast.type === 'warning'"
          (click)="toastService.dismiss(toast.id)">
          <div class="toast-content">
            <mat-icon class="toast-icon">
              @switch (toast.type) {
                @case ('success') { check_circle }
                @case ('error') { error }
                @case ('warning') { warning }
                @case ('info') { info }
              }
            </mat-icon>
            <span class="toast-message">{{ toast.message }}</span>
          </div>
          <button 
            class="toast-close" 
            type="button"
            (click)="$event.stopPropagation(); toastService.dismiss(toast.id)"
            aria-label="Close notification">
            <mat-icon>close</mat-icon>
          </button>
        </div>
      }
    </div>
  `,
  styles: [`
    .toast-container {
      position: fixed;
      top: 1rem;
      right: 1rem;
      z-index: 11000;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      max-width: 400px;
      pointer-events: none;
    }

    .toast {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      padding: 1rem 1.25rem;
      min-height: 60px;
      border-radius: 12px;
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
      pointer-events: auto;
      animation: slideIn 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      transition: all 0.3s ease;
    }

    @keyframes slideIn {
      from {
        transform: translateX(400px);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }

    .toast:hover {
      transform: translateX(-4px);
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3);
    }

    .toast-content {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      flex: 1;
    }

    .toast-icon {
      font-size: 1.5rem;
      width: 1.5rem;
      height: 1.5rem;
      flex-shrink: 0;
    }

    .toast-message {
      font-size: 0.9375rem;
      font-weight: 500;
      line-height: 1.4;
      color: var(--text-main);
    }

    .toast-close {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      position: relative;
      z-index: 1;
      border: none;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.2s ease;
      flex-shrink: 0;

      mat-icon {
        font-size: 1.125rem;
        width: 1.125rem;
        height: 1.125rem;
        color: var(--text-muted);
      }

      &:hover {
        background: rgba(255, 255, 255, 0.2);
        
        mat-icon {
          color: var(--text-main);
        }
      }
    }

    /* Toast type styles */
    .toast-success {
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.15) 0%, rgba(16, 185, 129, 0.05) 100%);
      border: 1px solid rgba(16, 185, 129, 0.3);

      .toast-icon {
        color: #10b981;
      }
    }

    .toast-error {
      background: linear-gradient(135deg, rgba(239, 68, 68, 0.15) 0%, rgba(239, 68, 68, 0.05) 100%);
      border: 1px solid rgba(239, 68, 68, 0.3);

      .toast-icon {
        color: #ef4444;
      }
    }

    .toast-warning {
      background: linear-gradient(135deg, rgba(245, 158, 11, 0.15) 0%, rgba(245, 158, 11, 0.05) 100%);
      border: 1px solid rgba(245, 158, 11, 0.3);

      .toast-icon {
        color: #f59e0b;
      }
    }

    .toast-info {
      background: linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(59, 130, 246, 0.05) 100%);
      border: 1px solid rgba(59, 130, 246, 0.3);

      .toast-icon {
        color: #3b82f6;
      }
    }

    @media (max-width: 768px) {
      .toast-container {
        top: auto;
        bottom: 1rem;
        left: 1rem;
        right: 1rem;
        max-width: none;
      }

      .toast {
        padding: 0.875rem 1rem;
        min-height: 56px;
      }

      .toast-message {
        font-size: 0.875rem;
      }
    }
  `]
})
export class ToastContainerComponent {
  toastService = inject(ToastService);
}
