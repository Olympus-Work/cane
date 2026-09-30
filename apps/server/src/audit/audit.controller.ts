import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { desc, lt } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { SessionGuard } from '../auth/guards.js';
import { DB } from '../db/db.module.js';
import { auditLog } from '../db/schema.js';
import { parseBefore, parseLimit } from '../paging.js';

/** Read-only, newest-first audit log with cursor pagination. */
@Controller('v1/audit-log')
@UseGuards(SessionGuard)
export class AuditController {
  constructor(@Inject(DB) private readonly db: NodePgDatabase) {}

  @Get()
  async list(@Query('limit') limit?: string, @Query('before') before?: string) {
    const n = parseLimit(limit);
    const cursor = parseBefore(before);
    const where = cursor === undefined ? undefined : lt(auditLog.id, cursor);
    const rows = await this.db.select().from(auditLog).where(where).orderBy(desc(auditLog.id)).limit(n + 1);
    const hasMore = rows.length > n;
    const items = rows.slice(0, n).map((r) => ({
      id: r.id,
      at: r.at.toISOString(),
      actor: r.actor,
      action: r.action,
      target: r.target,
      before: r.before,
      after: r.after,
      ip: r.ip,
    }));
    const last = items[items.length - 1];
    return { items, nextBefore: hasMore && last !== undefined ? last.id : null };
  }
}
