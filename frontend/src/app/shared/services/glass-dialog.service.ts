import {
  Injectable,
  ApplicationRef,
  ComponentRef,
  EnvironmentInjector,
  Injector,
  Type,
  createComponent,
} from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { GLASS_DIALOG_DATA } from './glass-dialog-data.token';

export interface GlassDialogConfig<D = unknown> {
  data?: D;
  disableClose?: boolean;
}

export class GlassDialogRef<R = unknown> {
  private readonly _afterClosed$ = new Subject<R | undefined>();

  /** Emits once when the dialog is closed, then completes. */
  readonly afterClosed$: Observable<R | undefined> = this._afterClosed$.asObservable();

  constructor(
    private readonly componentRef: ComponentRef<unknown>,
    private readonly overlayEl: HTMLElement,
  ) {}

  close(result?: R): void {
    this.overlayEl.classList.add('glass-dialog-closing');

    setTimeout(() => {
      this.componentRef.destroy();
      this.overlayEl.remove();
      this._afterClosed$.next(result);
      this._afterClosed$.complete();
    }, 200);
  }
}

@Injectable({ providedIn: 'root' })
export class GlassDialogService {
  constructor(
    private readonly appRef: ApplicationRef,
    private readonly envInjector: EnvironmentInjector,
  ) {}

  open<T, D = unknown, R = unknown>(
    component: Type<T>,
    config?: GlassDialogConfig<D>,
  ): GlassDialogRef<R> {
    // Full-screen overlay element
    const overlayEl = document.createElement('div');
    overlayEl.className = 'glass-dialog-overlay';

    // Panel wrapper (centres the dialog card)
    const panelEl = document.createElement('div');
    panelEl.className = 'glass-dialog-panel';
    overlayEl.appendChild(panelEl);

    // Build a dialogRef placeholder so we can pass it into the injector
    // We'll wire the real componentRef after creation.
    const dialogRef = new GlassDialogRef<R>(null as unknown as ComponentRef<unknown>, overlayEl);

    const customInjector = Injector.create({
      parent: this.envInjector,
      providers: [
        { provide: GLASS_DIALOG_DATA, useValue: config?.data ?? null },
        { provide: GlassDialogRef, useValue: dialogRef },
      ],
    });

    const componentRef = createComponent(component, {
      environmentInjector: this.envInjector,
      elementInjector: customInjector,
    });

    // Patch the componentRef into the already-created dialogRef
    (dialogRef as unknown as { componentRef: ComponentRef<unknown> }).componentRef = componentRef;

    panelEl.appendChild(componentRef.location.nativeElement);
    document.body.appendChild(overlayEl);
    this.appRef.attachView(componentRef.hostView);

    // Animate in
    requestAnimationFrame(() => overlayEl.classList.add('glass-dialog-visible'));

    // Backdrop click / Escape — only when disableClose is falsy
    if (!config?.disableClose) {
      overlayEl.addEventListener('click', (e) => {
        if (e.target === overlayEl) {
          dialogRef.close();
        }
      });

      const escHandler = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          dialogRef.close();
          document.removeEventListener('keydown', escHandler);
        }
      };
      document.addEventListener('keydown', escHandler);

      // Clean up the ESC listener when the dialog closes
      dialogRef.afterClosed$.subscribe(() =>
        document.removeEventListener('keydown', escHandler),
      );
    }

    return dialogRef;
  }
}
