import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './auth/auth.service';
import { ThemeService } from './core/theme.service';
import { ToastContainerComponent } from './shared/components/toast-container.component';
import { GlassIconComponent } from './shared/components/glass-icon.component';
import { GlassButtonComponent } from './shared/components/glass-button.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule, 
    RouterOutlet, 
    RouterLink, 
    RouterLinkActive, 
    ToastContainerComponent,
    GlassIconComponent,
    GlassButtonComponent
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  constructor(public auth: AuthService, public themeService: ThemeService) {}

  isNavExpanded = false;

  toggleNav(): void {
    this.isNavExpanded = !this.isNavExpanded;
  }

  logout(): void {
    this.auth.logout();
  }

  toggleTheme(): void {
    this.themeService.toggleTheme();
  }
}
