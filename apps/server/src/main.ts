import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NestFactory } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { configureApp, newAdapter } from './app.setup.js';

// apps/web/dist next to this server build; absent in dev, where Vite serves the web.
const WEB_DIST = fileURLToPath(new URL('../../web/dist/', import.meta.url));

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, newAdapter());
  await configureApp(app, { webDist: existsSync(WEB_DIST) ? WEB_DIST : undefined });
  await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
}

await bootstrap();
