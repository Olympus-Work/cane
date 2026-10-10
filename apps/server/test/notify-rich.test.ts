import { describe, expect, it } from 'vitest';
import { lineFlexMessage, parseMessage, telegramHtmlFields } from '../src/notify/rich.js';
import { renderMessage } from '../src/notify/templates.js';

const ENTRY = renderMessage('entry_filled', 'S-01', { pair: 'BTCUSDT', side: 'long', qty: '0.050', price: '61240.00', netPnl: '-1.25' });

type Bubble = {
  header: { backgroundColor: string; contents: { text: string }[] };
  body?: { contents: { contents: { text: string }[] }[] };
};
const bubble = (m: Record<string, unknown>) => m.contents as Bubble;
const rowsOf = (b: Bubble) => (b.body?.contents ?? []).map((r) => [r.contents[0]!.text, r.contents[1]!.text]);

describe('parseMessage', () => {
  it('reads title, strategy ID and readable labels back from the rendered text', () => {
    expect(parseMessage(ENTRY)).toEqual({
      title: 'Entry filled',
      strategyId: 'S-01',
      rows: [
        { label: 'Pair', value: 'BTCUSDT' },
        { label: 'Side', value: 'long' },
        { label: 'Qty', value: '0.050' },
        { label: 'Price', value: '61240.00' },
        { label: 'Net PnL', value: '-1.25' },
      ],
    });
  });

  it('keeps a value that contains ": " whole and joins a line without ": " to the previous value', () => {
    expect(parseMessage('[Live vs replay check] S-01\nwhat: BTCUSDT futures: 5/5 match\nsecond line').rows).toEqual([
      { label: 'Detail', value: 'BTCUSDT futures: 5/5 match\nsecond line' },
    ]);
  });

  it('takes a first line without brackets as the title', () => {
    expect(parseMessage('hello')).toEqual({ title: 'hello', strategyId: null, rows: [] });
  });
});

describe('lineFlexMessage', () => {
  it('builds a bubble with the event colour, title, strategy ID and label / value rows', () => {
    const m = lineFlexMessage(ENTRY, 'entry_filled');
    expect(m).toMatchObject({ type: 'flex', altText: ENTRY });
    const b = bubble(m);
    expect(b.header.backgroundColor).toBe('#16A34A');
    expect(b.header.contents.map((c) => c.text)).toEqual(['Entry filled', 'S-01']);
    expect(rowsOf(b)).toEqual([
      ['Pair', 'BTCUSDT'],
      ['Side', 'long'],
      ['Qty', '0.050'],
      ['Price', '61240.00'],
      ['Net PnL', '-1.25'],
    ]);
  });

  it.each([
    ['stop_triggered', '#DC2626'],
    ['kill_switch', '#DC2626'],
    ['jev_fallback', '#D97706'],
    ['reconcile_mismatch', '#D97706'],
    ['exit_filled', '#4F46E5'],
    ['replay_diff', '#4F46E5'],
    [null, '#4F46E5'],
  ] as const)('colours %s with %s', (event, color) => {
    expect(bubble(lineFlexMessage('[Title]', event)).header.backgroundColor).toBe(color);
  });

  it('has no body and only the title when there are no rows or strategy ID', () => {
    const b = bubble(lineFlexMessage(renderMessage('login_success', null, {}), 'login_success'));
    expect(b.header.contents.map((c) => c.text)).toEqual(['Login']);
    expect(b.body).toBeUndefined();
  });
});

describe('telegramHtmlFields', () => {
  it('sends HTML with a coloured dot, a bold title and bold labels', () => {
    expect(telegramHtmlFields(ENTRY, 'entry_filled')).toEqual({
      parse_mode: 'HTML',
      text: '🟢 <b>Entry filled</b> · S-01\n\n<b>Pair:</b> BTCUSDT\n<b>Side:</b> long\n<b>Qty:</b> 0.050\n<b>Price:</b> 61240.00\n<b>Net PnL:</b> -1.25',
    });
  });

  it('escapes HTML in values', () => {
    const fields = telegramHtmlFields('[Order rejected] S-02\nreason: qty < min & price > max', 'order_rejected');
    expect(fields.text).toBe('🔴 <b>Order rejected</b> · S-02\n\n<b>Reason:</b> qty &lt; min &amp; price &gt; max');
  });

  it('falls back to the plain text without parse_mode when the HTML would pass 4096 characters', () => {
    const long = `[Settings changed]\nwhat: ${'<'.repeat(1100)}`;
    expect(telegramHtmlFields(long, 'settings_changed')).toEqual({ text: long });
  });
});
