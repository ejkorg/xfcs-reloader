import { Routes } from '@angular/router';
import { authGuard } from './auth/auth.guard';
import { environment } from '../environments/environment';

const xfcsFeatureGuard = () => environment.featureFlags.xfcsReloaderEnabled;

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  {
    path: 'dashboard',
    canActivate: [authGuard, xfcsFeatureGuard],
    loadComponent: () => import('./xfcs/dashboard.component').then((m) => m.XfcsDashboardComponent)
  },
  {
    path: 'history',
    canActivate: [authGuard, xfcsFeatureGuard],
    loadComponent: () => import('./xfcs/xfcs-sessions.component').then((m) => m.XfcsSessionsComponent)
  },
  {
    path: 'monitor',
    canActivate: [authGuard, xfcsFeatureGuard],
    loadComponent: () => import('./xfcs/xfcs-file-monitor.component').then((m) => m.XfcsFileMonitorComponent)
  },
  {
    path: 'analytics',
    canActivate: [authGuard, xfcsFeatureGuard],
    loadComponent: () => import('./xfcs/xfcs-analytics.component').then((m) => m.XfcsAnalyticsComponent)
  },
  {
    path: 'coverage',
    canActivate: [authGuard, xfcsFeatureGuard],
    loadComponent: () => import('./xfcs/xfcs-coverage.component').then((m) => m.XfcsCoverageComponent)
  },
  {
    path: 'reload/new',
    canActivate: [authGuard, xfcsFeatureGuard],
    loadComponent: () => import('./xfcs/xfcs-stepper.component').then((m) => m.XfcsStepperComponent)
  },
  {
    path: 'login',
    loadComponent: () => import('./auth/login.component').then((m) => m.LoginComponent)
  },
  {
    path: 'register',
    loadComponent: () => import('./auth/register.component').then((m) => m.RegisterComponent)
  },
  {
    path: 'verify',
    loadComponent: () => import('./auth/verify.component').then((m) => m.VerifyComponent)
  },
  {
    path: 'request-reset',
    loadComponent: () => import('./auth/request-reset.component').then((m) => m.RequestResetComponent)
  },
  {
    path: 'reset-password',
    loadComponent: () => import('./auth/reset-password.component').then((m) => m.ResetPasswordComponent)
  },
  {
    // No auth guard — this is the landing point after SSO redirect from DTP backend
    path: 'sso-callback',
    loadComponent: () => import('./auth/sso-callback.component').then((m) => m.SsoCallbackComponent)
  },
  { path: '**', redirectTo: 'dashboard' }
];
