import type { ReactNode } from 'react';
import { Icon } from './Icon.js';

export type BadgeColor = 'teal' | 'amber' | 'sky' | 'green' | 'orange' | 'red' | 'purple';

export function Badge({ color, icon, children }: { color: BadgeColor; icon?: string; children: ReactNode }) {
  return (
    <span className={`badge badge-${color}`}>
      {icon ? <Icon name={icon} /> : null}
      {children}
    </span>
  );
}
