import { Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { AuditService } from '../audit/audit.service.js';
import { SessionGuard } from '../auth/guards.js';
import { ctxOf, type AuthedRequest } from '../auth/http.js';
import { EngineService } from '../engine/engine.service.js';
import { ExchangeStateService } from '../exchange/exchange-state.service.js';

/** B11: one click + one confirmation while logged in, so a session is enough (no fresh TOTP). */
@Controller('v1/kill-switch')
@UseGuards(SessionGuard)
export class KillSwitchController {
  constructor(
    private readonly engine: EngineService,
    private readonly exchange: ExchangeStateService,
    private readonly audit: AuditService,
  ) {}

  @Post()
  @HttpCode(200)
  async activate(@Req() req: AuthedRequest) {
    const activatedAt = new Date().toISOString();
    const results = await this.engine.killAll();
    await this.audit.record({ actor: 'owner', action: 'kill_switch', after: { activatedAt, results }, ip: ctxOf(req).ip });

    // B11.3: report what is still open on the exchange and not ours to touch (failed rows are still ours).
    const failed = new Set(results.filter((r) => r.status === 'failed' && r.market === 'futures').map((r) => r.pair));
    const { snapshot } = await this.exchange.view({ fresh: true }); // a cached one predates the closes
    const untouched = (snapshot?.futuresPositions ?? [])
      .filter((p) => !new Decimal(p.amount).isZero() && !failed.has(p.pair))
      .map((p) => ({ pair: p.pair, market: 'futures' as const }));
    return { activatedAt, results, untouched };
  }
}
