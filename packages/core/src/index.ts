export const CORE_VERSION = '0.0.0';

export * from './types.js';
export { ema, rma } from './indicators/ema.js';
export { atr, trueRange } from './indicators/atr.js';
export {
  cdcActionZone,
  DEFAULT_ACTION_ZONE,
  type ActionZoneBar,
  type ActionZoneParams,
} from './indicators/cdc-action-zone.js';
export { cdcTrail, DEFAULT_TRAIL, type TrailParams } from './indicators/cdc-trail.js';
export { analyzeTimeframe, lastClosedIndex, type TimeframeAnalysis } from './signals/analyze.js';
export {
  decide,
  evaluate,
  signalKey,
  WARMUP_CANDLES,
  LATE_ENTRY_TP_R,
  type Analyses,
  type Decision,
  type DecideInput,
  type EntryKind,
  type EvaluateInput,
  type NoneReason,
  type OpenPosition,
  type SignalRef,
  type StrategyInput,
} from './signals/evaluate.js';
