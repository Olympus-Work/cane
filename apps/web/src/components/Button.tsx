import type { ButtonHTMLAttributes } from 'react';
import { Icon } from './Icon.js';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  icon?: string;
  iconRight?: string;
  block?: boolean;
  /** Shows a spinner in place of the left icon and disables the button. */
  loading?: boolean;
}

export function Button({ variant = 'primary', size = 'md', icon, iconRight, block, loading, className, children, type = 'button', disabled, ...rest }: ButtonProps) {
  const cls = ['btn', `btn-${variant}`, `btn-${size}`];
  if (block) cls.push('btn-block');
  if (className) cls.push(className);
  return (
    <button type={type} className={cls.join(' ')} disabled={disabled || loading} {...rest}>
      {loading ? <Icon name="circle-notch" spin /> : icon ? <Icon name={icon} /> : null}
      {children}
      {iconRight ? <Icon name={iconRight} /> : null}
    </button>
  );
}
