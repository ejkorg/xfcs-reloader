import { Component, Input, Output, EventEmitter, forwardRef, signal, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-glass-input',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => GlassInputComponent),
      multi: true
    }
  ],
  template: `
    <div class="glass-input-container" [class.is-focused]="focused()" [class.has-value]="internalValue()" [class.has-error]="error">
      <div class="input-wrapper">
        <mat-icon *ngIf="prefixIcon" class="prefix-icon">{{ prefixIcon }}</mat-icon>
        
        <div class="field-content">
          <label *ngIf="label" class="floating-label">{{ label }}</label>
          <input
            #inputEl
            [type]="currentType()"
            [placeholder]="placeholder || ''"
            [attr.autocomplete]="autocomplete || null"
            (input)="onInput($event)"
            (focus)="onFocus()"
            (blur)="onBlur()"
            [disabled]="disabled"
            class="native-input"
          />
        </div>

        <mat-icon *ngIf="suffixIcon" class="suffix-icon" (click)="onSuffixClick($event)">{{ suffixIcon }}</mat-icon>
      </div>
      
      <div *ngIf="error" class="error-message">
        {{ error }}
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      width: 100%;
    }

    .glass-input-container {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .input-wrapper {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.75rem 1rem;
      min-height: 56px;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 14px;
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      transition: inherit;
      position: relative;
    }

    .input-wrapper::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 100%;
      border-radius: 14px;
      border: 1px solid transparent;
      transition: all 0.3s ease;
      pointer-events: none;
    }

    /* Light theme support */
    :host-context(body.light-theme) .input-wrapper {
      background: rgba(255, 255, 255, 0.9);
      border: 1px solid rgba(0, 0, 0, 0.15);
    }

    :host-context(body.light-theme) .input-wrapper:hover {
      border-color: rgba(0, 0, 0, 0.25);
    }

    .field-content {
      position: relative;
      flex: 1;
      display: flex;
      flex-direction: column;
    }

    .floating-label {
      font-size: 0.6875rem; // 11px - slightly smaller for better hierarchy
      font-weight: 600;
      color: var(--text-muted);
      letter-spacing: 0.05em; // Increased for better readability
      text-transform: uppercase;
      margin-bottom: 4px; // Increased from 2px
      transition: color 0.2s ease;
    }

    .native-input {
      background: transparent;
      border: none;
      outline: none;
      color: #fff;
      font-size: 0.9375rem; // 15px - optimal readability
      font-weight: 500;
      line-height: 1.5; // 22.5px - comfortable line height
      width: 100%;
      min-height: 40px; // Increased from 24px for better UX
      padding: 0;
      
      &::placeholder {
        color: rgba(255, 255, 255, 0.3); // Increased from 0.2 for better visibility
        font-weight: 400;
        font-size: 0.875rem; // 14px - slightly smaller for placeholder
      }

      /* Override browser autofill background — match the dark glass panel */
      &:-webkit-autofill,
      &:-webkit-autofill:hover,
      &:-webkit-autofill:focus {
        -webkit-box-shadow: 0 0 0 1000px rgba(15, 23, 42, 0.95) inset !important;
        -webkit-text-fill-color: #f8fafc !important;
        caret-color: #f8fafc;
        transition: background-color 9999s ease-in-out 0s;
      }
    }

    /* Light theme text color */
    :host-context(body.light-theme) .native-input {
      color: var(--text-main);
      
      &::placeholder {
        color: rgba(0, 0, 0, 0.4);
      }

      &:-webkit-autofill,
      &:-webkit-autofill:hover,
      &:-webkit-autofill:focus {
        -webkit-box-shadow: 0 0 0 1000px rgba(255, 255, 255, 0.98) inset !important;
        -webkit-text-fill-color: #0f172a !important;
        caret-color: #0f172a;
        transition: background-color 9999s ease-in-out 0s;
      }
    }

    .prefix-icon, .suffix-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--text-muted);
      transition: color 0.2s ease;
      font-size: 1.25rem;
      width: 1.25rem;
      height: 1.25rem;
      font-family: 'Material Icons' !important;
    }

    .suffix-icon {
      cursor: pointer;
      &:hover { color: var(--accent-color); }
    }

    /* States */
    .is-focused .input-wrapper {
      background: rgba(255, 255, 255, 0.05);
      border-color: var(--accent-color);
      box-shadow: 0 0 0 2px rgba(129, 140, 248, 0.2), inset 0 1px 2px rgba(0, 0, 0, 0.1);
    }

    .is-focused .input-wrapper::before {
      border-color: var(--accent-color);
      box-shadow: 0 0 20px rgba(129, 140, 248, 0.15);
    }

    :host-context(body.light-theme) .is-focused .input-wrapper {
      background: rgba(255, 255, 255, 1);
      border-color: var(--accent-color);
      box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.1);
    }

    :host-context(body.light-theme) .is-focused .input-wrapper::before {
      border-color: var(--accent-color);
    }

    .is-focused .floating-label {
      color: var(--accent-color);
    }

    .is-focused .prefix-icon {
      color: var(--accent-color);
    }

    .has-error .input-wrapper {
      border-color: rgba(239, 68, 68, 0.5);
      background: rgba(239, 68, 68, 0.05);
    }

    .has-error .input-wrapper::before {
      border-color: rgba(239, 68, 68, 0.3);
      box-shadow: 0 0 12px rgba(239, 68, 68, 0.1);
    }

    .error-message {
      font-size: 0.75rem;
      color: #f87171;
      padding-left: 0.5rem;
    }

    /* High DPI screens blur fix */
    @media (-webkit-min-device-pixel-ratio: 2), (min-resolution: 192dpi) {
      .input-wrapper { backdrop-filter: blur(20px); }
    }
  `]
})
export class GlassInputComponent implements ControlValueAccessor {
  @ViewChild('inputEl') inputEl!: ElementRef<HTMLInputElement>;

  @Input() label: string = '';
  @Input() placeholder: string = '';
  @Input() suffixIcon: string = '';
  @Input() prefixIcon: string = '';
  @Input() autocomplete: string = '';
  @Input() error: string | null = null;
  @Output() suffixAction = new EventEmitter<void>();
  @Output() valueChange = new EventEmitter<string>();

  /** The base type (text, password, email, etc.) */
  @Input() set type(val: string) { this._type.set(val || 'text'); }
  private _type = signal('text');

  /** Exposed so the parent can toggle password visibility by changing [type] */
  currentType = this._type.asReadonly();

  @Input() set value(val: string) {
    this.internalValue.set(val || '');
    // Only push to DOM if the element exists and isn't focused (avoid stealing cursor)
    if (this.inputEl?.nativeElement && document.activeElement !== this.inputEl.nativeElement) {
      this.inputEl.nativeElement.value = val || '';
    }
  }

  get value(): string { return this.internalValue(); }

  internalValue = signal('');
  focused = signal(false);
  disabled = false;

  onChange: any = () => {};
  onTouched: any = () => {};

  writeValue(val: string): void {
    const str = val || '';
    this.internalValue.set(str);
    // Only update DOM value when the input is NOT focused — prevents cursor jump
    if (this.inputEl?.nativeElement && document.activeElement !== this.inputEl.nativeElement) {
      this.inputEl.nativeElement.value = str;
    }
  }

  registerOnChange(fn: any): void { this.onChange = fn; }
  registerOnTouched(fn: any): void { this.onTouched = fn; }
  setDisabledState(isDisabled: boolean): void { this.disabled = isDisabled; }

  onInput(event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    this.internalValue.set(val);
    this.onChange(val);
    this.valueChange.emit(val);
  }

  onFocus(): void { this.focused.set(true); }

  onBlur(): void {
    this.focused.set(false);
    this.onTouched();
  }

  onSuffixClick(event: MouseEvent): void {
    // Prevent the click from blurring the input
    event.preventDefault();
    this.suffixAction.emit();
    // Return focus to the input after suffix interaction
    this.inputEl?.nativeElement?.focus();
  }
}
