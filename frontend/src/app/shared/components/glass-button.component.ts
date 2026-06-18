import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-glass-button',
  standalone: true,
  imports: [CommonModule],
  template: `
    <button 
      [type]="type"
      [disabled]="disabled || loading"
      [class]="'glass-btn glass-btn-' + variant + ' glass-btn-' + size"
      (click)="handleClick($event)">
      <span class="btn-content" [class.loading]="loading">
        <ng-content></ng-content>
      </span>
      <span class="btn-loader" *ngIf="loading">
        <svg class="spinner" viewBox="0 0 24 24" width="16" height="16">
          <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" fill="none" opacity="0.25"/>
          <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round"/>
        </svg>
      </span>
    </button>
  `,
  styles: [`
    .glass-btn {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      padding: 0.625rem 1.25rem;
      border-radius: 10px;
      font-size: 0.875rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
      border: 1px solid transparent;
      outline: none;
      white-space: nowrap;
      overflow: hidden;
    }

    .glass-btn::before {
      content: '';
      position: absolute;
      top: 0;
      left: -100%;
      width: 100%;
      height: 100%;
      background: rgba(255, 255, 255, 0.12);
      transition: left 0.3s ease-out;
      pointer-events: none;
      z-index: 0;
    }

    .glass-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none !important;
    }

    /* Primary Button */
    .glass-btn-primary {
      background: var(--accent-color);
      color: #fff;
      border-color: var(--accent-color);
      box-shadow: 0 4px 12px rgba(129, 140, 248, 0.25);
    }

    .glass-btn-primary:hover:not(:disabled) {
      background: rgba(129, 140, 248, 0.9);
      box-shadow: 0 6px 16px rgba(129, 140, 248, 0.35);
      transform: translateY(-2px);

      &::before {
        left: 100%;
      }
    }

    .glass-btn-primary:active:not(:disabled) {
      transform: translateY(0);
    }

    /* Secondary Button */
    .glass-btn-secondary {
      background: rgba(255, 255, 255, 0.05);
      color: var(--text-main);
      border-color: rgba(255, 255, 255, 0.15);
    }

    .glass-btn-secondary:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.1);
      border-color: rgba(255, 255, 255, 0.25);
      transform: translateY(-1px);

      &::before {
        left: 100%;
      }
    }

    /* Tertiary/Text Button */
    .glass-btn-tertiary {
      background: transparent;
      color: var(--text-muted);
      border-color: transparent;
    }

    .glass-btn-tertiary:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.05);
      color: var(--text-main);

      &::before {
        left: 100%;
      }
    }

    /* Danger Button */
    .glass-btn-danger {
      background: rgba(239, 68, 68, 0.15);
      color: #ef4444;
      border-color: rgba(239, 68, 68, 0.3);
    }

    .glass-btn-danger:hover:not(:disabled) {
      background: rgba(239, 68, 68, 0.25);
      border-color: rgba(239, 68, 68, 0.4);
      transform: translateY(-1px);

      &::before {
        left: 100%;
      }
    }

    /* Icon Button */
    .glass-btn-icon {
      padding: 0.5rem;
      width: 36px;
      height: 36px;
      border-radius: 8px;
    }

    .glass-btn-icon:hover:not(:disabled) {
      opacity: 0.8;
      transform: scale(1.08);
    }

    /* Sizes */
    .glass-btn-small {
      padding: 0.4rem 0.875rem;
      font-size: 0.8125rem;
      height: 32px;
    }

    .glass-btn-medium {
      padding: 0.625rem 1.25rem;
      font-size: 0.875rem;
      height: 40px;
    }

    .glass-btn-large {
      padding: 0.75rem 1.5rem;
      font-size: 1rem;
      height: 48px;
    }

    /* Loading State */
    .btn-content.loading {
      opacity: 0;
    }

    .btn-loader {
      position: absolute;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .spinner {
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    /* Focus State with Ring */
    .glass-btn:focus-visible {
      box-shadow: 0 0 0 3px rgba(129, 140, 248, 0.3), 0 0 0 1px rgba(129, 140, 248, 0.5);
      outline: none;
    }

    :host-context(body.light-theme) .glass-btn:focus-visible {
      box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.2), 0 0 0 1px rgba(79, 70, 229, 0.4);
    }
  `]
})
export class GlassButtonComponent {
  @Input() type: 'button' | 'submit' | 'reset' = 'button';
  @Input() variant: 'primary' | 'secondary' | 'tertiary' | 'danger' | 'icon' = 'primary';
  @Input() size: 'small' | 'medium' | 'large' = 'medium';
  @Input() disabled: boolean = false;
  @Input() loading: boolean = false;
  @Output() clicked = new EventEmitter<Event>();

  handleClick(event: Event) {
    if (!this.disabled && !this.loading) {
      this.clicked.emit(event);
    }
  }
}
