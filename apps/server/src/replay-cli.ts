import 'reflect-metadata';
import { CommandFactory } from 'nest-commander';
import { cliServiceErrorHandler } from './cli/cli-error.js';
import { ReplayCliModule } from './cli/replay-cli.module.js';

await CommandFactory.run(ReplayCliModule, { logger: ['warn', 'error'], serviceErrorHandler: cliServiceErrorHandler });
