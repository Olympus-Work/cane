import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Command, CommandRunner, Option } from 'nest-commander';
import type { Market } from '@cane/core';
import { formatReplayReport } from '../replay/report.js';
import type { ReplayResult } from '../replay/replay.types.js';
import { ReplayService } from '../replay/replay.service.js';

interface ReplayOptions {
  pairs: string[];
  markets?: Market[];
  from: string;
  to: string;
  out?: string;
}

function parseDate(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Expected YYYY-MM-DD, got "${value}"`);
  const ms = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(ms)) throw new Error(`Invalid date "${value}"`);
  return ms;
}

@Command({
  name: 'replay',
  description: 'Replay the signal rules over Binance public closed candles and print a Markdown report',
})
export class ReplayCommand extends CommandRunner {
  constructor(private readonly replay: ReplayService) {
    super();
  }

  override async run(_args: string[], options: ReplayOptions): Promise<void> {
    const from = parseDate(options.from);
    const to = parseDate(options.to);
    if (to <= from) throw new Error('--to must be after --from');
    const results: ReplayResult[] = [];
    for (const pair of options.pairs) {
      for (const market of options.markets ?? ['futures']) {
        process.stderr.write(`replay ${pair} ${market} ...\n`);
        results.push(await this.replay.run({ pair, market, from, to }));
      }
    }
    const report = formatReplayReport(results, new Date());
    if (options.out) {
      await mkdir(path.dirname(options.out), { recursive: true });
      await writeFile(options.out, report);
      process.stderr.write(`wrote ${options.out}\n`);
    } else {
      process.stdout.write(report);
    }
  }

  @Option({ flags: '--pairs <pairs>', description: 'Comma-separated USDT pairs, e.g. BTCUSDT,ETHUSDT', required: true })
  parsePairs(value: string): string[] {
    const pairs = value.split(',').map((p) => p.trim().toUpperCase());
    for (const p of pairs) if (!/^[A-Z0-9]{2,16}USDT$/.test(p)) throw new Error(`Not a USDT pair: ${p}`);
    return pairs;
  }

  @Option({ flags: '--markets <markets>', description: 'Comma-separated: spot,futures (default futures)' })
  parseMarkets(value: string): Market[] {
    return value.split(',').map((m) => {
      const t = m.trim();
      if (t !== 'spot' && t !== 'futures') throw new Error(`Unknown market: ${t}`);
      return t;
    });
  }

  @Option({ flags: '--from <date>', description: 'Start date YYYY-MM-DD (UTC)', required: true })
  parseFrom(value: string): string {
    parseDate(value);
    return value;
  }

  @Option({ flags: '--to <date>', description: 'End date YYYY-MM-DD (UTC, exclusive)', required: true })
  parseTo(value: string): string {
    parseDate(value);
    return value;
  }

  @Option({ flags: '--out <file>', description: 'Write the Markdown report to this file instead of stdout' })
  parseOut(value: string): string {
    return value;
  }
}
