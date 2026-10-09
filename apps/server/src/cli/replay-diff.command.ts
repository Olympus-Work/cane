import { Command, CommandRunner, Option } from 'nest-commander';
import { previousUtcDay } from '../replay/diff.js';
import { ReplayDiffService } from '../replay-diff/replay-diff.service.js';

interface ReplayDiffOptions {
  day?: string;
}

@Command({
  name: 'replay-diff',
  description: 'Compare live 4H decisions of one UTC day with the replay and print the result as JSON',
  options: { isDefault: true },
})
export class ReplayDiffCommand extends CommandRunner {
  constructor(private readonly diff: ReplayDiffService) {
    super();
  }

  override async run(_args: string[], options: ReplayDiffOptions): Promise<void> {
    const result = await this.diff.run(options.day ?? previousUtcDay(Date.now()));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }

  @Option({ flags: '--day <YYYY-MM-DD>', description: 'UTC day to check (default: yesterday)' })
  parseDay(value: string): string {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Expected YYYY-MM-DD, got "${value}"`);
    return value;
  }
}
