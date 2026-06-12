import type { Database } from './client.js';
import { memberships, organizations, users } from './schema.js';

/**
 * Tenant-creation helpers. Creating an organization establishes a new tenant,
 * so these are intentionally not tenant-scoped. Everything else goes through
 * the tenant-scoped repository (see repositories.ts).
 */

export async function createOrganization(db: Database, name: string) {
  const [row] = await db.insert(organizations).values({ name }).returning();
  return row!;
}

export async function createUser(db: Database, email: string, name?: string) {
  const [row] = await db
    .insert(users)
    .values({ email, name: name ?? null })
    .returning();
  return row!;
}

export async function addMembership(
  db: Database,
  organizationId: string,
  userId: string,
  role = 'owner',
) {
  const [row] = await db.insert(memberships).values({ organizationId, userId, role }).returning();
  return row!;
}
