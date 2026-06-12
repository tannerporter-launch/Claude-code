import {
  type Database,
  addMembership,
  createOrganization,
  createTenantRepository,
  createUser,
  recordAuditEvent,
} from '@echoloop/database';
import { createEncryptionService } from '@echoloop/security';

/**
 * Synthetic seed data. Tokens are encrypted with the supplied key; nothing here
 * is real correspondence or a real credential (BUILD_BRIEF: synthetic fixtures
 * only, never live inbox data).
 */
export interface SeedResult {
  organizationId: string;
  userId: string;
  emailAccountId: string;
}

export async function seed(db: Database, encryptionKey: string): Promise<SeedResult> {
  const enc = createEncryptionService(encryptionKey);

  const org = await createOrganization(db, 'EchoLoop Pilot Org');
  const user = await createUser(db, 'pilot@example.test', 'Pilot User');
  await addMembership(db, org.id, user.id, 'owner');

  const repo = createTenantRepository(db, { organizationId: org.id });
  const account = await repo.emailAccounts.create({
    userId: user.id,
    providerEmail: 'pilot@example.test',
    encryptedAccessToken: enc.encrypt('synthetic-access-token'),
    encryptedRefreshToken: enc.encrypt('synthetic-refresh-token'),
    status: 'disconnected',
  });

  await recordAuditEvent(
    db,
    { organizationId: org.id },
    'seed.loaded',
    { note: 'synthetic seed' },
    user.id,
  );

  return { organizationId: org.id, userId: user.id, emailAccountId: account.id };
}
