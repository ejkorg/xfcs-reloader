import { inject } from '@angular/core';
import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { catchError, throwError } from 'rxjs';
import { AuthService } from './auth.service';
import { SessionExpiryService } from './session-expiry.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const sessionExpiryService = inject(SessionExpiryService);
  const token = auth.getToken();
  const isAnonymousAuthEndpoint = /\/api\/auth\/(login|register|verify|request-reset|reset-password|refresh)(\/|$|\?)/.test(req.url);

  let request = req;
  if (token && !isAnonymousAuthEndpoint) {
    request = req.clone({
      setHeaders: {
        Authorization: `Bearer ${token}`
      }
    });
  }

  return next(request).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status === 401 && !isAnonymousAuthEndpoint) {
        sessionExpiryService.notifyExpired();
      }
      return throwError(() => error);
    })
  );
};
