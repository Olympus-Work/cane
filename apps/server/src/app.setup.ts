import fastifyCookie from '@fastify/cookie';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FastifyAdapter } from '@nestjs/platform-fastify';

/** Behind Railway's proxy `req.ip` must be the client's, so the session list and audit log show real IPs. */
export const newAdapter = (): FastifyAdapter => new FastifyAdapter({ trustProxy: true });

/** Shared by main.ts and the HTTP tests: the cookie plugin the session guard reads. */
export async function configureApp(app: NestFastifyApplication): Promise<void> {
  await app.register(fastifyCookie);
}
