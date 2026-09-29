import pg from 'pg';
import { migrateDown, migrateUp } from './db/migrate.js';

// Usage: node dist/db-cli.js up | down [steps]. Reads DATABASE_URL only.
const [command, steps] = process.argv.slice(2);
const url = process.env.DATABASE_URL;
if (!url || (command !== 'up' && command !== 'down')) {
  console.error('usage: DATABASE_URL=... node dist/db-cli.js up | down [steps]');
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
