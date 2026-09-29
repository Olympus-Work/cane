import '@fastify/cookie'; // adds req.cookies / reply.setCookie to the Fastify types
import { BadRequestException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { RequestCtx } from './auth.service.js';

export const SESSION_COOKIE = 'cane_session';
export const TOTP_HEADER = 'x-totp-code';

/** A request after `SessionGuard`. */
export type AuthedRequest = FastifyRequest & { session: { id: string } };

export function ctxOf(req: FastifyRequest): RequestCtx {
  const ua = req.headers['user-agent'];
  return { ip: req.ip ?? null, device: typeof ua === 'string' ? ua : null };
}

/** A required string field of a JSON body, or a 400 that names the field. */
export function str(body: unknown, field: string, max = 512): string {
  const v = typeof body === 'object' && body !== null ? (body as Record<string, unknown>)[field] : undefined;
  if (typeof v !== 'string' || v.length === 0 || v.length > max) throw new BadRequestException(`${field} is required`);
  return v;
}

/** An optional string field: undefined if absent, a 400 if present but not a usable string. */
export function optStr(body: unknown, field: string, max = 512): string | undefined {
  const v = typeof body === 'object' && body !== null ? (body as Record<string, unknown>)[field] : undefined;
  return v === undefined ? undefined : str(body, field, max);
}
