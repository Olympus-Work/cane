import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTheme } from '../theme.js';
import { Icon } from './Icon.js';

export interface ModalProps {
  title: string;
  body?: string;
  icon: string;
  tone?: 'accent' | 'danger';
  onClose(): void;
  children?: ReactNode;
  footer?: ReactNode;
}

export function Modal({ title, body, icon, tone = 'accent', onClose, children, footer }: ModalProps) {
  const { theme } = useTheme();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  // Move focus into the dialog on open; restore it to the previously focused element on close.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const target = dialogRef.current?.querySelector<HTMLElement>('input, button, [tabindex]') ?? dialogRef.current;
    target?.focus();
    return () => {
      previous?.focus();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className={`modal-root${theme === 'light' ? ' light' : ''}`}>
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialogRef}>
        <div className="modal-header">
          <span className={`modal-icon-tile${tone === 'danger' ? ' modal-icon-tile-danger' : ''}`} aria-hidden="true">
            <Icon name={icon} />
          </span>
          <div>
            <h2 className="modal-title" id={titleId}>
              {title}
            </h2>
            {body ? <p className="modal-body">{body}</p> : null}
          </div>
        </div>
        {children}
        {footer}
      </div>
    </div>,
    document.body,
  );
}
