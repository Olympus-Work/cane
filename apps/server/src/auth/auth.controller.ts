import { BadRequestException, Body, Controller, Get, HttpCode, Post, Req, Res, UnauthorizedException, UseGuards, HttpException } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuthService } from './auth.service.js';
import { FreshTotpGuard, SessionGuard } from './guards.js';
import { SESSION_COOKIE, ctxOf, str, type AuthedRequest } from './http.js';

@Controller('v1/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const r = await this.auth.login(str(body, 'email'), str(body, 'password', 1024), str(body, 'code', 32), ctxOf(req));
    if (!r.ok) {
      if (r.reason === 'locked') throw new HttpException('Too many failed attempts. Try again in 15 minutes.', 423);
      throw new UnauthorizedException('Email, password or code is wrong');
    }
    reply.setCookie(SESSION_COOKIE, r.token, { httpOnly: true, secure: true, sameSite: 'strict', path: '/', expires: r.expiresAt });
    return { expiresAt: r.expiresAt.toISOString() };
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async logout(@Req() req: AuthedRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<void> {
    await this.auth.logout(req.session.id, ctxOf(req));
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  @Get('sessions')
  @UseGuards(SessionGuard)
  async sessions(@Req() req: AuthedRequest) {
    const list = await this.auth.listSessions();
    return { sessions: list.map((s) => ({ ...s, current: s.id === req.session.id })) };
  }

  @Post('password')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async password(@Body() body: unknown, @Req() req: AuthedRequest): Promise<void> {
    const r = await this.auth.changePassword(str(body, 'currentPassword', 1024), str(body, 'newPassword', 1024), req.session.id, ctxOf(req));
    if (r === 'wrong_password') throw new UnauthorizedException('Current password is wrong');
    if (r === 'weak_password') throw new BadRequestException('New password must be at least 12 characters');
  }

  @Post('totp/setup')
  @HttpCode(200)
  @UseGuards(SessionGuard, FreshTotpGuard)
  totpSetup(@Req() req: AuthedRequest) {
    return this.auth.beginTotpSetup(ctxOf(req));
  }

  @Post('totp/confirm')
  @HttpCode(200)
  @UseGuards(SessionGuard)
  async totpConfirm(@Body() body: unknown, @Req() req: AuthedRequest) {
    const codes = await this.auth.confirmTotpSetup(str(body, 'code', 32), req.session.id, ctxOf(req));
    if (!codes) throw new BadRequestException('That code does not match the new authenticator');
    return { recoveryCodes: codes };
  }

  @Post('recovery-codes')
  @HttpCode(200)
  @UseGuards(SessionGuard, FreshTotpGuard)
  async recoveryCodes(@Req() req: AuthedRequest) {
    return { recoveryCodes: await this.auth.regenerateRecoveryCodes(ctxOf(req)) };
  }
}
