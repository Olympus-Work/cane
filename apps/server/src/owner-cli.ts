import 'reflect-metadata';
import { CommandFactory } from 'nest-commander';
import { OwnerCliModule } from './owner/owner-cli.module.js';

await CommandFactory.run(OwnerCliModule, { logger: ['warn', 'error'] });
