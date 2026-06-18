import { Injectable, signal } from '@angular/core';

export interface Toast {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  message: string;
  duration: number;
  createdAt: number;
  expiresAt?: number;
}

@Injectable({
  providedIn: 'root'
})
export class ToastService {
  toasts = signal<Toast[]>([]);
  private idCounter = 0;
  private cleanupIntervalId: ReturnType<typeof setInterval>;
  private dismissTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor() {
    this.cleanupIntervalId = setInterval(() => {
      const now = Date.now();
      this.toasts.update((toasts: Toast[]) => toasts.filter((toast: Toast) => !toast.expiresAt || toast.expiresAt > now));
    }, 1000);
  }

  private show(type: Toast['type'], message: string, duration?: number) {
    const id = `toast-${++this.idCounter}`;
    const createdAt = Date.now();
    const resolvedDuration = duration === 0
      ? 0
      : (typeof duration === 'number' && Number.isFinite(duration) && duration > 0 ? duration : 5000);
    const toast: Toast = {
      id,
      type,
      message,
      duration: resolvedDuration,
      createdAt,
      expiresAt: resolvedDuration > 0 ? createdAt + resolvedDuration : undefined
    };
    
    this.toasts.update((toasts: Toast[]) => [...toasts, toast]);

    if (resolvedDuration > 0) {
      const timer = setTimeout(() => this.dismiss(id), resolvedDuration);
      this.dismissTimers.set(id, timer);
    }
  }

  success(message: string, duration?: number) {
    this.show('success', message, duration);
  }

  error(message: string, duration?: number) {
    this.show('error', message, duration);
  }

  info(message: string, duration?: number) {
    this.show('info', message, duration);
  }

  warning(message: string, duration?: number) {
    this.show('warning', message, duration);
  }

  dismiss(id: string) {
    const timer = this.dismissTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.dismissTimers.delete(id);
    }
    this.toasts.update((toasts: Toast[]) => toasts.filter((toast: Toast) => toast.id !== id));
  }

  clear() {
    this.dismissTimers.forEach((timer) => clearTimeout(timer));
    this.dismissTimers.clear();
    this.toasts.set([]);
  }
}
