import { Component, Input, signal, effect, ElementRef, ViewChild, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GlassIconComponent } from './glass-icon.component';

export interface ActivityEvent {
  id: string;
  type: 'file' | 'lot' | 'session';
  message: string;
  timestamp: string;
  icon: string;
  color: 'primary' | 'success' | 'warning' | 'error' | 'muted' | 'default';
}

@Component({
  selector: 'app-activity-feed',
  standalone: true,
  imports: [CommonModule, GlassIconComponent],
  template: `
    <div class="activity-feed glass-panel">
      <div class="feed-header">
        <div class="header-title">
          <app-glass-icon name="timeline" [size]="20" color="primary"></app-glass-icon>
          <span class="title-text">Activity Feed</span>
        </div>
        <span class="event-count">{{ activities().length }} events</span>
      </div>

      <div class="feed-content" #feedContent>
        <div class="activity-list" *ngIf="activities().length > 0; else noActivity">
          <div class="activity-item" *ngFor="let activity of activities(); trackBy: trackByActivityId">
            <div class="activity-icon" [class]="'icon-' + activity.type">
              <app-glass-icon 
                [name]="activity.icon" 
                [size]="16" 
                [color]="activity.color">
              </app-glass-icon>
            </div>
            <div class="activity-content">
              <p class="activity-message">{{ activity.message }}</p>
              <span class="activity-time">{{ formatTime(activity.timestamp) }}</span>
            </div>
          </div>
        </div>

        <ng-template #noActivity>
          <div class="empty-state">
            <app-glass-icon name="timeline" [size]="48" color="muted"></app-glass-icon>
            <p class="empty-message">No activity yet</p>
            <p class="empty-hint">Events will appear here as processing begins</p>
          </div>
        </ng-template>
      </div>
    </div>
  `,
  styles: [`
    .activity-feed {
      display: flex;
      flex-direction: column;
      height: 100%;
      max-height: 600px;
    }

    .feed-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 1rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    }

    .header-title {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .title-text {
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--text-main);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .event-count {
      font-size: 0.75rem;
      color: var(--text-muted);
      padding: 0.25rem 0.5rem;
      background: rgba(255, 255, 255, 0.05);
      border-radius: 4px;
    }

    .feed-content {
      flex: 1;
      overflow-y: auto;
      padding: 0.5rem;
    }

    .feed-content::-webkit-scrollbar {
      width: 6px;
    }

    .feed-content::-webkit-scrollbar-track {
      background: rgba(255, 255, 255, 0.02);
      border-radius: 3px;
    }

    .feed-content::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.1);
      border-radius: 3px;
    }

    .feed-content::-webkit-scrollbar-thumb:hover {
      background: rgba(255, 255, 255, 0.15);
    }

    .activity-list {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .activity-item {
      display: flex;
      gap: 0.75rem;
      padding: 0.75rem;
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.02);
      transition: background 0.2s ease;
      animation: slideIn 0.3s ease;
    }

    .activity-item:hover {
      background: rgba(255, 255, 255, 0.05);
    }

    @keyframes slideIn {
      from {
        opacity: 0;
        transform: translateY(-10px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .activity-icon {
      width: 32px;
      height: 32px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .activity-icon.icon-file {
      background: rgba(129, 140, 248, 0.15);
    }

    .activity-icon.icon-lot {
      background: rgba(245, 158, 11, 0.15);
    }

    .activity-icon.icon-session {
      background: rgba(16, 185, 129, 0.15);
    }

    .activity-content {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .activity-message {
      font-size: 0.8125rem;
      color: var(--text-main);
      margin: 0;
      line-height: 1.4;
    }

    .activity-time {
      font-size: 0.6875rem;
      color: var(--text-muted);
      font-weight: 500;
    }

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 3rem 1rem;
      gap: 0.75rem;
      text-align: center;
    }

    .empty-message {
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--text-main);
      margin: 0;
    }

    .empty-hint {
      font-size: 0.75rem;
      color: var(--text-muted);
      margin: 0;
    }

    @media (max-width: 768px) {
      .activity-feed {
        max-height: 400px;
      }

      .feed-header {
        flex-direction: column;
        align-items: flex-start;
        gap: 0.5rem;
      }
    }
  `]
})
export class ActivityFeedComponent implements AfterViewInit {
  @ViewChild('feedContent') feedContent?: ElementRef<HTMLDivElement>;
  
  @Input() set events(value: ActivityEvent[]) {
    this.activities.set(value || []);
  }

  activities = signal<ActivityEvent[]>([]);
  private shouldAutoScroll = true;

  constructor() {
    // Auto-scroll to bottom when new activities are added
    effect(() => {
      const events = this.activities();
      if (events.length > 0 && this.shouldAutoScroll) {
        setTimeout(() => this.scrollToBottom(), 100);
      }
    });
  }

  ngAfterViewInit(): void {
    // Detect manual scrolling
    this.feedContent?.nativeElement.addEventListener('scroll', () => {
      const element = this.feedContent?.nativeElement;
      if (element) {
        const isAtBottom = element.scrollHeight - element.scrollTop <= element.clientHeight + 50;
        this.shouldAutoScroll = isAtBottom;
      }
    });
  }

  private scrollToBottom(): void {
    if (this.feedContent) {
      const element = this.feedContent.nativeElement;
      element.scrollTop = element.scrollHeight;
    }
  }

  trackByActivityId(index: number, activity: ActivityEvent): string {
    return activity.id;
  }

  formatTime(timestamp: string): string {
    try {
      const date = new Date(timestamp);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffSec = Math.floor(diffMs / 1000);
      const diffMin = Math.floor(diffSec / 60);
      const diffHour = Math.floor(diffMin / 60);

      if (diffSec < 60) {
        return 'Just now';
      } else if (diffMin < 60) {
        return `${diffMin}m ago`;
      } else if (diffHour < 24) {
        return `${diffHour}h ago`;
      } else {
        return date.toLocaleTimeString('en-US', { 
          hour: '2-digit', 
          minute: '2-digit' 
        });
      }
    } catch {
      return timestamp;
    }
  }
}
