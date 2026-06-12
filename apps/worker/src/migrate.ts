import { createPgDatabase, migratePg } from '@echoloop/database';
import { createLogger } from '@echoloop/security';
import { requireDatabaseUrl } from '@echoloop/schemas';

/**
 * Apply committed migrations to the configured PostgreSQL database.
 * Usage: `node apps/worker/dist/migrate.js` (with DATABASE_URL set).
 */
export async function runMigrations(): Promise<void> {
  const logger = createLogger({ base: { component: 'migrate' } });
  const { db, close } = await createPgDatabase(requireDatabaseUrl());
  try {
    await migratePg(db);
    logger.info('migrations applied');
  } finally {
    await close();
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  runMigrations().catch((err: unknown) => {
    createLogger({ base: { component: 'migrate' } }).error('migration failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exitCode = 1;
  });
}
