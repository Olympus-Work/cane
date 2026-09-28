import 'reflect-metadata';
import { CommandFactory } from 'nest-commander';
import { ReplayCliModule } from './cli/replay-cli.module.js';

await CommandFactory.run(ReplayCliModule, { logger: ['warn', 'error'] });
