import type { ExitReason } from '../api.js';

export interface ExitReasonView {
  icon: string;
  family?: 'solid' | 'regular';
  label: string;
}

/** Icon and translated label for a trade's exit reason (spec B16.5). An unknown reason shows as its raw text. */
export function exitReasonView(reason: ExitReason, t: (key: string) => string): ExitReasonView {
  switch (reason) {
    case 'first_red':
      return { icon: 'square', label: t('firstRed') };
    case 'first_green':
      return { icon: 'square', family: 'regular', label: t('firstGreen') };
    case 'stop':
      return { icon: 'hand', label: t('stopR') };
    case 'take_profit':
      return { icon: 'bullseye', label: t('tpR') };
    case 'kill_switch':
      return { icon: 'power-off', label: t('killR') };
    case 'flip':
      return { icon: 'right-left', label: t('flipR') };
    case 'manual':
      return { icon: 'user', label: t('exitManual') };
    case 'liquidated':
      return { icon: 'skull-crossbones', label: t('exitLiquidated') };
    default:
      return { icon: 'circle', label: reason };
  }
}
