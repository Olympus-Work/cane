import pg from 'pg';
import { migrateDown, migrateUp } from './db/migrate.js';

// Usage: node dist/db-cli.js up | down [steps]. Reads MIGRATION_DATABASE_URL, else DATABASE_URL:
// on Railway migrations run as the superuser while the server's DATABASE_URL is a cane_app user (plan, S12).
const [command, steps] = process.argv.slice(2);
const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!url || (command !== 'up' && command !== 'down')) {
  console.error('usage: [MIGRATION_]DATABASE_URL=... node dist/db-cli.js up | down [steps]');
  process.exit(2);
}

const pool = new pg.Pool({ connectionString: url });
try {
  if (command === 'up') await migrateUp(pool);
  else await migrateDown(pool, steps ? Number(steps) : Infinity);
  console.log(`migrate ${command}: done`);
} finally {
  await pool.end();
}
