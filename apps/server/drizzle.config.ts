import { defineConfig } from 'drizzle-kit';

// Only `generate` / `check` use this file; they need no database connection.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
});
