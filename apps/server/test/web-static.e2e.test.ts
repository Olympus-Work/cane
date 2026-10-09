import 'reflect-metadata';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { configureApp, newAdapter } from '../src/app.setup.js';
import { HealthController } from '../src/health/health.controller.js';

// S12: the server serves the web build from the API's origin (session cookie is sameSite=strict).
describe('web build served by the server (S12)', () => {
  let app: NestFastifyApplication;
  let webDist: string;

  beforeAll(async () => {
    webDist = mkdtempSync(join(tmpdir(), 'cane-web-'));
    writeFileSync(join(webDist, 'index.html'), '<!doctype html><title>Cane</title>');
    mkdirSync(join(webDist, 'assets'));
    writeFileSync(join(webDist, 'assets', 'app.js'), 'console.log(1);');
    const moduleRef = await Test.createTestingModule({ controllers: [HealthController] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(newAdapter());
    await configureApp(app, { webDist });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
    rmSync(webDist, { recursive: true, force: true });
  });

  it('GET / returns index.html', async () => {
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.payload).toContain('<title>Cane</title>');
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it('serves built assets', async () => {
    const res = await app.inject({ method: 'GET', url: '/assets/app.js' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('javascript');
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('API routes still win: /health is JSON', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('an unknown /v1 path is still a JSON 404, not a page', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/json');
  });
});
