import { type CanActivate, type ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AuthService } from './auth.service.js';
import { SESSION_COOKIE, TOTP_HEADER, ctxOf, type AuthedRequest } from './http.js';

/** A valid, unexpired session cookie (B14.4). Sets `req.session`. */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<FastifyRequest & { session?: { id: string } }>();
    const token = req.cookies?.[SESSION_COOKIE];
    const session = token ? await this.auth.validateSession(token) : null;
    if (!session) throw new UnauthorizedException('Not signed in');
    req.session = session;
    return true;
  }
}

/** B14.5: a TOTP code sent with this very request, in the `x-totp-code` header. Use after `SessionGuard`. */
@Injectable()
export class FreshTotpGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const code = req.headers[TOTP_HEADER];
    if (typeof code !== 'string' || !(await this.auth.verifyFreshTotp(code, ctxOf(req)))) {
      throw new ForbiddenException('A fresh authenticator code is required');
    }
    return true;
  }
}
