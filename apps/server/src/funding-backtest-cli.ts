import 'reflect-metadata';
import { CommandFactory } from 'nest-commander';
import { cliServiceErrorHandler } from './cli/cli-error.js';
import { FundingBacktestCliModule } from './cli/funding-backtest-cli.module.js';

// The only env read of the backtest: the read-only `cane_replay` user (plan F02, as the
// replay-diff). No fallback to DATABASE_URL, which is the server's write-capable user.
const url = process.env.REPLAY_DATABASE_URL;
if (!url) {
  process.stderr.write('REPLAY_DATABASE_URL is not set\n');
  process.exit(2);
}
await CommandFactory.run(FundingBacktestCliModule.forUrl(url), {
  logger: ['warn', 'error'],
  serviceErrorHandler: cliServiceErrorHandler,
});
