import { Injectable, OnDestroy } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { environment } from '../../environments/environment';
import { ReloadSessionEvent } from './xfcs-models';
import { XfcsApiService } from './xfcs-api.service';
import { AuthService } from '../auth/auth.service';

const BACKOFF_DELAYS_MS = [1000, 2000, 4000, 8000, 16000, 30000];
const MAX_RETRIES = 5;
const FALLBACK_POLL_MS = 10000;

/**
 * Manages SSE connections for reload session streams.
 * Handles exponential back-off reconnection and falls back to polling after 5 failures.
 */
@Injectable({ providedIn: 'root' })
export class SseService implements OnDestroy {

  private sources = new Map<string, EventSource>();
  private subjects = new Map<string, Subject<ReloadSessionEvent>>();
  private retryCounters = new Map<string, number>();
  private retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private pollTimers = new Map<string, ReturnType<typeof setInterval>>();
  private lastEventIds = new Map<string, number>();

  constructor(private api: XfcsApiService, private auth: AuthService) {}

  /**
   * Opens an SSE stream for the given session.
   * Emits ReloadSessionEvent objects as they arrive.
   * Reconnects with exponential back-off on error; falls back to polling after 5 retries.
   */
  connect(sessionId: string, lastEventId?: number): Observable<ReloadSessionEvent> {
    // Reuse existing subject if already connected
    if (this.subjects.has(sessionId)) {
      return this.subjects.get(sessionId)!.asObservable();
    }

    const subject = new Subject<ReloadSessionEvent>();
    this.subjects.set(sessionId, subject);
    this.retryCounters.set(sessionId, 0);
    if (lastEventId != null) {
      this.lastEventIds.set(sessionId, lastEventId);
    }

    this.openSource(sessionId);
    return subject.asObservable();
  }

  /** Closes the SSE stream for a session and cleans up resources. */
  disconnect(sessionId: string): void {
    this.cleanup(sessionId);
    const subject = this.subjects.get(sessionId);
    if (subject) {
      subject.complete();
      this.subjects.delete(sessionId);
    }
  }

  ngOnDestroy(): void {
    for (const sessionId of Array.from(this.subjects.keys())) {
      this.disconnect(sessionId);
    }
  }

  private openSource(sessionId: string): void {
    const lastEventId = this.lastEventIds.get(sessionId);
    const url = this.buildUrl(sessionId, lastEventId);

    const source = new EventSource(url, { withCredentials: true });
    this.sources.set(sessionId, source);

    source.onmessage = (event) => {
      try {
        const parsed: ReloadSessionEvent = JSON.parse(event.data);
        if (parsed.id != null) {
          this.lastEventIds.set(sessionId, parsed.id);
        }
        // Reset retry counter on successful message
        this.retryCounters.set(sessionId, 0);
        this.subjects.get(sessionId)?.next(parsed);
      } catch (e) {
        console.warn('[SseService] Failed to parse SSE event:', event.data);
      }
    };

    source.onerror = () => {
      source.close();
      this.sources.delete(sessionId);
      this.scheduleReconnect(sessionId);
    };
  }

  private scheduleReconnect(sessionId: string): void {
    const retries = this.retryCounters.get(sessionId) ?? 0;

    if (retries >= MAX_RETRIES) {
      console.warn(`[SseService] Max retries reached for session ${sessionId}. Falling back to polling.`);
      this.startPollingFallback(sessionId);
      return;
    }

    const delayMs = BACKOFF_DELAYS_MS[Math.min(retries, BACKOFF_DELAYS_MS.length - 1)];
    this.retryCounters.set(sessionId, retries + 1);

    const timer = setTimeout(() => {
      this.retryTimers.delete(sessionId);
      if (this.subjects.has(sessionId)) {
        this.openSource(sessionId);
      }
    }, delayMs);

    this.retryTimers.set(sessionId, timer);
  }

  private startPollingFallback(sessionId: string): void {
    const poll = setInterval(() => {
      const subject = this.subjects.get(sessionId);
      if (!subject) {
        clearInterval(poll);
        return;
      }
      const lastId = this.lastEventIds.get(sessionId) ?? 0;
      this.api.getReloadEvents(sessionId).subscribe({
        next: (events) => {
          for (const ev of events) {
            if (ev.id != null && ev.id > lastId) {
              this.lastEventIds.set(sessionId, ev.id);
              subject.next(ev);
            }
          }
        },
        error: () => {} // keep polling silently
      });
    }, FALLBACK_POLL_MS);

    this.pollTimers.set(sessionId, poll);
  }

  private cleanup(sessionId: string): void {
    const source = this.sources.get(sessionId);
    if (source) {
      source.close();
      this.sources.delete(sessionId);
    }
    const retryTimer = this.retryTimers.get(sessionId);
    if (retryTimer) {
      clearTimeout(retryTimer);
      this.retryTimers.delete(sessionId);
    }
    const pollTimer = this.pollTimers.get(sessionId);
    if (pollTimer) {
      clearInterval(pollTimer);
      this.pollTimers.delete(sessionId);
    }
    this.retryCounters.delete(sessionId);
    this.lastEventIds.delete(sessionId);
  }

  private buildUrl(sessionId: string, lastEventId?: number): string {
    const base = `${environment.apiUrl}/xfcs/reload/${encodeURIComponent(sessionId)}/stream`;
    let url = lastEventId != null ? `${base}?lastEventId=${lastEventId}` : base;
    const token = this.auth.getToken();
    if (token) {
      url += (url.includes('?') ? '&' : '?') + `token=${encodeURIComponent(token)}`;
    }
    return url;
  }
}
