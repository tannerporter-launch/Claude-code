import { fileURLToPath } from 'node:url';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { schema } from './schema.js';

/**
 * The shared database handle type. Both the node-postgres (dev/prod) and PGlite
 * (tests) drivers expose the same Drizzle query-builder surface, so the rest of
 * the codebase programs against this single type. The PGlite test harness casts
 * its instance to this type (see @echoloop/testing).
 */
export type Database = NodePgDatabase<typeof schema>;

/** Absolute path to the committed SQL migrations directory. */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../drizzle', import.meta.url));

export interface PgConnection {
  db: Database;
  close: () => Promise<void>;
}

/** Create a real PostgreSQL connection (dev/prod). Loads `pg` lazily. */
export async function createPgDatabase(connectionString: string): Promise<PgConnection> {
  const { drizzle } = await import('drizzle-orm/node-postgres');
  const pgModule = (await import('pg')) as unknown as {
    default: { Pool: new (config: { connectionString: string }) => { end: () => Promise<void> } };
  };
  const pool = new pgModule.default.Pool({ connectionString });
  const db = drizzle(pool as never, { schema });
  return { db, close: () => pool.end() };
}

/** Run committed migrations against a real PostgreSQL connection. */
export async function migratePg(db: Database): Promise<void> {
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}
