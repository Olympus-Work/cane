import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Pool } from 'pg';

/** Same path from `src/db` (tests) and `dist/db` (built CLI): both are two levels under apps/server. */
export const MIGRATIONS_DIR = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));

interface JournalEntry {
  tag: string;
  when: number;
}

/** Applies every pending migration (drizzle journal order). */
export async function migrateUp(pool: Pool): Promise<void> {
  await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_DIR });
}

/**
 * Reverts the newest `steps` applied migrations (default: all), newest first.
 * Each revert runs `migrations/down/<tag>.sql` and removes the drizzle
 * bookkeeping row (keyed by the journal's `when`) in one transaction.
 */
export async function migrateDown(pool: Pool, steps = Infinity): Promise<void> {
  const journal = JSON.parse(await readFile(`${MIGRATIONS_DIR}/meta/_journal.json`, 'utf8')) as {
    entries: JournalEntry[];
  };
  const applied = await pool
    .query<{ created_at: string }>('select created_at from drizzle.__drizzle_migrations order by created_at desc')
    .catch(() => ({ rows: [] }));
  const byWhen = new Map(journal.entries.map((e) => [String(e.when), e]));

  for (const row of applied.rows.slice(0, steps)) {
    const entry = byWhen.get(String(row.created_at));
    if (!entry) throw new Error(`applied migration ${row.created_at} is not in the journal`);
    const sql = await readFile(`${MIGRATIONS_DIR}/down/${entry.tag}.sql`, 'utf8');
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(sql);
      await client.query('delete from drizzle.__drizzle_migrations where created_at = $1', [row.created_at]);
      await client.query('commit');
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
  }
}
