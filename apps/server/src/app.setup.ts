import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { relative, sep } from 'node:path';
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
  const root = opts.webDist;
  if (!root) return;
  await app.register(fastifyStatic, {
    root,
    // Vite content-hashes everything under assets/, so it can be cached forever;
    // the rest (index.html first) is revalidated, or a redeploy would leave a
    // cached page pointing at assets that no longer exist.
    setHeaders: (reply, path) => {
      const hashed = relative(root, path).startsWith(`assets${sep}`);
      reply.header('cache-control', hashed ? 'public, max-age=31536000, immutable' : 'no-cache');
    },
  });
}
