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
  primaryStop,
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
export {
  MAX_LEVERAGE,
  LIQUIDATION_BUFFER,
  bracketFor,
  liquidationPrice,
  stopInsideLiquidation,
  validateLeverage,
  type LeverageBracket,
} from './risk/leverage.js';
export {
  FACTOR_BONUS_PCT,
  MAX_SIZE_PCT,
  BASE_PCT_MIN,
  BASE_PCT_MAX,
  planEntry,
  roundDownToStep,
  roundToTick,
  sizePct,
  targetNotional,
  type EntryPlan,
  type EntryPlanEvent,
  type EntryPlanInput,
  type SizingMode,
  type SymbolFilters,
} from './sizing/size.js';
export {
  BIG_BODY_ATR,
  BIG_BODY_ATR_LENGTH,
  CHANNEL_LOOKBACK,
  CHANNEL_MIN_PIVOTS,
  CHANNEL_TOUCH_PCT,
  EXHAUSTION_BARS,
  FACTOR_NAMES,
  PIVOT_LEFT,
  PIVOT_RIGHT,
  SWING_LOOKBACK,
  VOLUME_AVG_BARS,
  confluenceFeatures,
  type ChannelFeature,
  type ConfluenceFeatures,
  type ExhaustionFeature,
  type FactorName,
  type SwingFeature,
} from './features/confluence.js';
export {
  CLIENT_ORDER_ID_RE,
  ORDER_ACTIONS,
  clientOrderId,
  type OrderAction,
} from './orders/client-order-id.js';
export {
  DEFAULT_CONFIDENCE_THRESHOLD,
  FLIP_MIN_FACTORS,
  decideFlip,
  presentFactorCount,
  type FlipDecision,
  type FlipInput,
  type JevFactor,
  type JevResult,
  type PositionExitReason,
} from './signals/flip.js';
