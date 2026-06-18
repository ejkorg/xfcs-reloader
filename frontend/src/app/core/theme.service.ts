import { Injectable, effect, signal } from '@angular/core';

export type ThemeMode = 'light' | 'dark';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly THEME_KEY = 'xfcs-reloader-theme';

  readonly theme = signal<ThemeMode>(this.getInitialTheme());

  constructor() {
    effect(() => {
      const currentTheme = this.theme();
      this.applyTheme(currentTheme);
      localStorage.setItem(this.THEME_KEY, currentTheme);
    });
  }

  toggleTheme(): void {
    this.theme.update((t) => (t === 'light' ? 'dark' : 'light'));
  }

  private getInitialTheme(): ThemeMode {
    const saved = localStorage.getItem(this.THEME_KEY) as ThemeMode | null;
    if (saved === 'light' || saved === 'dark') {
      return saved;
    }

    return 'dark';
  }

  private applyTheme(theme: ThemeMode): void {
    const body = document.body;
    if (theme === 'light') {
      body.classList.add('light-theme');
      body.classList.remove('dark-theme');
      return;
    }

    body.classList.add('dark-theme');
    body.classList.remove('light-theme');
  }
}
