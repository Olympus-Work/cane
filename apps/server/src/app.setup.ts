import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FastifyAdapter } from '@nestjs/platform-fastify';

/**
 * Behind Railway's proxy `req.ip` must be the client's, so the session list and
 * audit log show real IPs. This trusts X-Forwarded-For from any peer: it is only
 * right while the server is reachable through the proxy alone (checked at S12).
 */
export const newAdapter = (): FastifyAdapter => new FastifyAdapter({ trustProxy: true });

/**
 * Shared by main.ts and the HTTP tests: the cookie plugin the session guard reads,
 * and (when `webDist` is given) the web build from the same origin as the API, as
 * the `secure` + `sameSite=strict` session cookie needs (plan, S12).
 */
export async function configureApp(app: NestFastifyApplication, opts: { webDist?: string } = {}): Promise<void> {
  await app.register(fastifyCookie);
  if (opts.webDist) await app.register(fastifyStatic, { root: opts.webDist });
}
