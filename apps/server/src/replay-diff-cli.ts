import 'reflect-metadata';
import { CommandFactory } from 'nest-commander';
import { ReplayDiffCliModule } from './cli/replay-diff-cli.module.js';

// The only env read of the replay-diff: the read-only `cane_replay` user (plan S13).
// No fallback to DATABASE_URL, which is the server's write-capable user.
const url = process.env.REPLAY_DATABASE_URL;
if (!url) {
  process.stderr.write('REPLAY_DATABASE_URL is not set\n');
  process.exit(2);
}
await CommandFactory.run(ReplayDiffCliModule.forUrl(url), { logger: ['warn', 'error'] });
