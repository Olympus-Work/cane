import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { configureApp, newAdapter } from './app.setup.js';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, newAdapter());
  await configureApp(app);
  await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
}

await bootstrap();
