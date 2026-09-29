import { Global, Inject, Module, type OnModuleDestroy } from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';

export const PG_POOL = Symbol('PG_POOL');
export const DB = Symbol('DB');

/** Postgres pool + Drizzle from `DATABASE_URL`. */
@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      useFactory: () => {
        const url = process.env.DATABASE_URL;
        if (!url) throw new Error('DATABASE_URL is not set');
        return new pg.Pool({ connectionString: url });
      },
    },
    { provide: DB, inject: [PG_POOL], useFactory: (pool: pg.Pool): NodePgDatabase => drizzle(pool) },
  ],
  exports: [DB],
})
export class DbModule implements OnModuleDestroy {
  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {}

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
