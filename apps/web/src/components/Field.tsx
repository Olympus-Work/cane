import { Icon } from './Icon.js';

export interface FieldProps {
  id: string;
  label: string;
  value: string;
  onChange(value: string): void;
  type?: 'text' | 'password' | 'email' | 'number';
  icon?: string;
  hint?: string;
  placeholder?: string;
  error?: string;
  autoComplete?: string;
  inputMode?: 'text' | 'numeric' | 'decimal';
  maxLength?: number;
  mono?: boolean;
  disabled?: boolean;
  required?: boolean;
}

export function Field({ id, label, value, onChange, type = 'text', icon, hint, placeholder, error, autoComplete, inputMode, maxLength, mono, disabled, required }: FieldProps) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className={`field-wrap${icon ? ' field-wrap-icon' : ''}${mono ? ' mono' : ''}`}>
        {icon ? <Icon name={icon} className="field-icon" /> : null}
        <input
          id={id}
          className="field-input"
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          inputMode={inputMode}
          maxLength={maxLength}
          disabled={disabled}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
        />
      </div>
      {error ? (
        <p className="field-error" id={`${id}-error`} role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="field-hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
