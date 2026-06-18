import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
    selector: 'glass-loading-overlay',
    standalone: true,
    imports: [CommonModule],
    template: `
        <div class="loading-overlay" [class.visible]="visible" [attr.aria-hidden]="!visible">
            <div class="overlay-backdrop" (click)="$event.stopPropagation()"></div>
            <div class="overlay-content">
                <div class="spinner-container">
                    <div class="spinner"></div>
                </div>
                <div class="loading-text" *ngIf="message">
                    {{ message }}
                </div>
                <div class="loading-subtext" *ngIf="subtext">
                    {{ subtext }}
                </div>
            </div>
        </div>
    `,
    styles: [`
        .loading-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            z-index: 9000;
            display: flex;
            align-items: center;
            justify-content: center;
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.2s ease-in-out;
        }

        .loading-overlay.visible {
            opacity: 1;
            pointer-events: all;
        }

        .overlay-backdrop {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            backdrop-filter: blur(4px);
            -webkit-backdrop-filter: blur(4px);
        }

        .overlay-content {
            position: relative;
            z-index: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 1.5rem;
            padding: 2rem;
            background: rgba(255, 255, 255, 0.95);
            border-radius: 16px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.3);
            min-width: 300px;
            animation: slideUp 0.3s ease-out;
        }

        @keyframes slideUp {
            from {
                transform: translateY(20px);
                opacity: 0;
            }
            to {
                transform: translateY(0);
                opacity: 1;
            }
        }

        .spinner-container {
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .spinner {
            width: 48px;
            height: 48px;
            border: 4px solid rgba(99, 102, 241, 0.1);
            border-top-color: #6366f1;
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
            to {
                transform: rotate(360deg);
            }
        }

        .loading-text {
            font-size: 1.125rem;
            font-weight: 600;
            color: #1f2937;
            text-align: center;
        }

        .loading-subtext {
            font-size: 0.875rem;
            color: #6b7280;
            text-align: center;
            max-width: 400px;
        }

        /* Dark mode support */
        @media (prefers-color-scheme: dark) {
            .overlay-content {
                background: rgba(31, 41, 55, 0.95);
                border: 1px solid rgba(255, 255, 255, 0.1);
            }

            .loading-text {
                color: #f9fafb;
            }

            .loading-subtext {
                color: #9ca3af;
            }
        }
    `]
})
export class GlassLoadingOverlayComponent {
    @Input() visible = false;
    @Input() message = 'Loading...';
    @Input() subtext = '';
}
