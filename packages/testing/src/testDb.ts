import { PGlite } from '@electric-sql/pglite';
import { type Database, MIGRATIONS_FOLDER, schema } from '@echoloop/database';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';

/**
 * An in-process PostgreSQL (PGlite) database with the committed migrations
 * applied. Used by automated tests so the suite runs with no Postgres server.
 * The PGlite Drizzle instance is structurally identical to the node-postgres
 * one, so it is exposed as the shared `Database` type.
 */
export interface TestDatabase {
  db: Database;
  close: () => Promise<void>;
}

export async function createTestDb(): Promise<TestDatabase> {
  const client = new PGlite();
  const db = drizzle(client, { schema }) as unknown as Database;
  await migrate(db as never, { migrationsFolder: MIGRATIONS_FOLDER });
  return {
    db,
    close: async () => {
      await client.close();
    },
  };
}
