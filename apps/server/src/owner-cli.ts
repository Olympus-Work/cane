import 'reflect-metadata';
import { CommandFactory } from 'nest-commander';
import { cliServiceErrorHandler } from './cli/cli-error.js';
import { OwnerCliModule } from './owner/owner-cli.module.js';

await CommandFactory.run(OwnerCliModule, { logger: ['warn', 'error'], serviceErrorHandler: cliServiceErrorHandler });
