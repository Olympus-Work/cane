import { Inject, Injectable } from '@nestjs/common';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DB } from '../db/db.module.js';
import { auditLog } from '../db/schema.js';

export interface AuditEntry {
  actor: string;
  action: string;
  target?: string;
  /** Already redacted: never put a key, secret, token, password or code in here. */
  before?: unknown;
  after?: unknown;
  ip?: string | null;
}

/** Append-only audit trail (spec Interfaces). The app role can only INSERT. */
@Injectable()
export class AuditService {
  constructor(@Inject(DB) private readonly db: NodePgDatabase) {}

  async record(e: AuditEntry): Promise<void> {
    await this.db.insert(auditLog).values({
      actor: e.actor,
      action: e.action,
      target: e.target ?? null,
      before: e.before ?? null,
      after: e.after ?? null,
      ip: e.ip ?? null,
    });
  }
}
