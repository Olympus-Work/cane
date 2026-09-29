import pg from 'pg';
import { migrateUp } from '../../src/db/migrate.js';

/** DATABASE_URL of a throwaway Postgres (README "Database"); DB tests are skipped without it. */
export const DATABASE_URL = process.env.DATABASE_URL;

/** Drops everything, then migrates up: a fresh schema for one test file. Never point at a real database. */
export async function freshDb(): Promise<pg.Pool> {
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  for (const sql of [
    'drop schema if exists drizzle cascade',
    'drop schema public cascade',
    'create schema public',
    'drop role if exists cane_readonly',
    'drop role if exists cane_app',
  ]) {
    await pool.query(sql);
  }
  await migrateUp(pool);
  return pool;
}
