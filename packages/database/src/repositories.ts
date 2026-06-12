import { and, eq } from 'drizzle-orm';
import type { Database } from './client.js';
import { dataDeletionRequests, dataExportRequests, emailAccounts } from './schema.js';

/**
 * Tenant-scoped data access. Every query is constrained to the organization in
 * the context, so a caller holding org B's context can never read or mutate
 * org A's rows — cross-tenant access fails closed (BUILD_BRIEF invariant).
 */

export interface TenantContext {
  organizationId: string;
}

export interface NewEmailAccount {
  userId: string;
  providerEmail: string;
  provider?: string;
  encryptedAccessToken?: string;
  encryptedRefreshToken?: string;
  status?: string;
}

export function createTenantRepository(db: Database, ctx: TenantContext) {
  const orgId = ctx.organizationId;

  return {
    emailAccounts: {
      async create(input: NewEmailAccount) {
        const [row] = await db
          .insert(emailAccounts)
          .values({
            organizationId: orgId,
            userId: input.userId,
            provider: input.provider ?? 'gmail',
            providerEmail: input.providerEmail,
            encryptedAccessToken: input.encryptedAccessToken ?? null,
            encryptedRefreshToken: input.encryptedRefreshToken ?? null,
            status: input.status ?? 'disconnected',
          })
          .returning();
        return row!;
      },

      /** Returns the row only if it belongs to this tenant; otherwise undefined. */
      async getById(id: string) {
        const rows = await db
          .select()
          .from(emailAccounts)
          .where(and(eq(emailAccounts.id, id), eq(emailAccounts.organizationId, orgId)));
        return rows[0];
      },

      async list() {
        return db.select().from(emailAccounts).where(eq(emailAccounts.organizationId, orgId));
      },
    },

    dataRequests: {
      async requestExport(userId: string) {
        const [row] = await db
          .insert(dataExportRequests)
          .values({ organizationId: orgId, userId })
          .returning();
        return row!;
      },
      async requestDeletion(userId: string) {
        const [row] = await db
          .insert(dataDeletionRequests)
          .values({ organizationId: orgId, userId })
          .returning();
        return row!;
      },
    },
  };
}

export type TenantRepository = ReturnType<typeof createTenantRepository>;
