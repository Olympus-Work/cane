import { Module } from '@nestjs/common';
import { StrategiesController } from './strategies.controller.js';

@Module({ controllers: [StrategiesController] })
export class StrategiesModule {}
