import { FACTOR_NAMES, type ConfluenceFeatures, type FactorName, type JevFactor, type JevResult, type Side } from '@cane/core';
import type { JevCall, JevClassifier } from '../engine/ports.js';

export const JEV_URL = 'https://api.typesafe.ai/v1/systemone';
/** Pinned so live and replay agree (plan S07); `jev-latest` moves. */
export const JEV_MODEL = 'jev-1.13.0';
/** B8.4 default; S08 makes it a Setting. */
export const JEV_DEFAULT_TIMEOUT_MS = 3000;
/** A Noul at or above this is a "yes" (`present`); the strategy threshold is applied on `confidence`. */
export const PRESENT_AT = 0.5;

export type JevFetch = (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<Response>;

export interface JevClientDeps {
  apiKey: string;
  fetch: JevFetch;
  now: () => number;
  timeoutMs?: number;
  model?: string;
}

/** The three Noul questions (B8). Wording is behaviour: change it only with a plan.md update. */
const QUESTIONS: Record<FactorName, string> = {
  channel_breakout:
    'Does this daily candle break out upward from a descending channel drawn through the recent pivot highs, given the channel features?',
  capitulation:
    'Do the recent candles show capitulation (sellers exhausted after big bearish bodies, gap-downs and a volume spike) just before this daily candle?',
  higher_low: 'Do the last two swing lows form a higher low, given the swing features?',
  channel_breakdown:
    'Does this daily candle break down from an ascending channel drawn through the recent pivot lows, given the channel features?',
  euphoria:
    'Do the recent candles show euphoria (buyers exhausted after big bullish bodies, gap-ups and a volume spike) just before this daily candle?',
  lower_high: 'Do the last two swing highs form a lower high, given the swing features?',
};

const n = (v: { toString(): string } | null): string => (v === null ? 'none' : v.toString());

/** Deterministic text for the model: fixed order, numbers only (B8.2). */
export function serialiseState(f: ConfluenceFeatures): string {
  return [
    `side: ${f.side}`,
    `timeframe: ${f.timeframe}`,
    `channel.pivot_count: ${f.channel.pivotCount}`,
    `channel.slope_pct_per_bar: ${n(f.channel.slopePctPerBar)}`,
    `channel.touches: ${f.channel.touches}`,
    `channel.close_beyond_line_pct: ${n(f.channel.closeBeyondPct)}`,
    `exhaustion.longest_big_body_run: ${f.exhaustion.longestBigBodyRun}`,
    `exhaustion.gap_count: ${f.exhaustion.gapCount}`,
    `exhaustion.volume_spike_ratio: ${n(f.exhaustion.volumeSpike)}`,
    `swing.change_pct: ${n(f.swing.changePct)}`,
    `swing.bars_apart: ${f.swing.barsApart === null ? 'none' : f.swing.barsApart}`,
  ].join('\n');
}

interface Parsed {
  factors: [JevFactor, JevFactor, JevFactor];
  model: string | null;
}

/** Hand-checked shape: three Noul answers under the factor names, each a finite number in [0,1]. */
function parse(body: unknown, side: Side): Parsed | null {
  if (typeof body !== 'object' || body === null) return null;
  const answers = (body as { answers?: unknown }).answers;
  if (typeof answers !== 'object' || answers === null) return null;
  const factors: JevFactor[] = [];
  for (const name of FACTOR_NAMES[side]) {
    const a = (answers as Record<string, unknown>)[name];
    if (typeof a !== 'object' || a === null) return null;
    const { type, noul } = a as { type?: unknown; noul?: unknown };
    if (type !== 'noul' || typeof noul !== 'number' || !Number.isFinite(noul) || noul < 0 || noul > 1) return null;
    factors.push({ present: noul >= PRESENT_AT, confidence: noul });
  }
  const model = (body as { model?: unknown }).model;
  return { factors: factors as [JevFactor, JevFactor, JevFactor], model: typeof model === 'string' ? model : null };
}

/**
 * B8: asks Jev three Noul questions about one side on the signal candle.
 * Any failure comes back as `{ ok: false }` (B8.4); it never throws and never
 * retries (the 3 s budget covers the whole call, body included).
 */
export class JevClient implements JevClassifier {
  private readonly timeoutMs: number;
  private readonly model: string;

  constructor(private readonly d: JevClientDeps) {
    this.timeoutMs = d.timeoutMs ?? JEV_DEFAULT_TIMEOUT_MS;
    this.model = d.model ?? JEV_MODEL;
  }

  async classify(input: { side: Side; timeframe: '1d'; features: ConfluenceFeatures }): Promise<JevCall> {
    const questions: Record<string, unknown> = {};
    for (const name of FACTOR_NAMES[input.side]) questions[name] = { type: 'noul', instructions: QUESTIONS[name] };
    const request = { model: this.model, state: serialiseState(input.features), questions };

    const started = this.d.now();
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => {
        abort.abort();
        resolve('timeout');
      }, this.timeoutMs);
    });
    const call = async (): Promise<{ status: number; body: unknown }> => {
      const res = await this.d.fetch(JEV_URL, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.d.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify(request),
        signal: abort.signal,
      });
      const text = await res.text();
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {
        /* keep the raw text as the stored response */
      }
      return { status: res.status, body };
    };

    const fail = (reason: 'timeout' | 'error' | 'invalid_response', error: string, response: unknown = null, model = this.model): JevCall => ({
      result: { ok: false, reason },
      model,
      request,
      response,
      error,
      latencyMs: this.d.now() - started,
    });

    try {
      const pending = call();
      pending.catch(() => undefined); // a call that loses the race may still reject later
      const out = await Promise.race([pending, timedOut]);
      if (out === 'timeout') return fail('timeout', `no answer within ${this.timeoutMs} ms`);
      if (out.status < 200 || out.status >= 300) return fail('error', `HTTP ${out.status}`, out.body);
      const parsed = parse(out.body, input.side);
      if (!parsed) return fail('invalid_response', 'unexpected response shape', out.body);
      const result: JevResult = { ok: true, factors: parsed.factors };
      return { result, model: parsed.model ?? this.model, request, response: out.body, error: null, latencyMs: this.d.now() - started };
    } catch (e) {
      // Only the error class: a message could echo request details.
      return fail('error', `request failed (${e instanceof Error ? e.name : 'unknown'})`);
    } finally {
      clearTimeout(timer);
    }
  }
}
