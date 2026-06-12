import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Phase 1 core schema: identity/tenancy + operations only. Domain tables
 * (Gmail, context/generation, pairing, learning) are added by the phases that
 * first write them (incremental migrations, see docs/DECISIONS.md D-004).
 *
 * Every tenant-scoped table carries organization_id so isolation is explicit.
 * Columns holding secrets or correspondence store ciphertext produced by
 * @echoloop/security; the database treats them as opaque text.
 */

export const organizations = pgTable('organizations', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('owner'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgUserUnique: unique('memberships_org_user_unique').on(table.organizationId, table.userId),
  }),
);

export const emailAccounts = pgTable(
  'email_accounts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull().default('gmail'),
    providerEmail: text('provider_email').notNull(),
    // Ciphertext envelopes from @echoloop/security; never plaintext.
    encryptedAccessToken: text('encrypted_access_token'),
    encryptedRefreshToken: text('encrypted_refresh_token'),
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
    lastHistoryId: text('last_history_id'),
    status: text('status').notNull().default('disconnected'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    providerEmailUnique: unique('email_accounts_provider_email_unique').on(
      table.provider,
      table.providerEmail,
    ),
  }),
);

export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    // Redacted, non-sensitive metadata only. Never raw bodies/tokens/prompts.
    detail: jsonb('detail')
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgIdx: index('audit_events_org_idx').on(table.organizationId),
  }),
);

export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    payload: jsonb('payload')
      .notNull()
      .default(sql`'{}'::jsonb`),
    status: text('status').notNull().default('pending'),
    // Optional caller-supplied key making enqueue idempotent.
    idempotencyKey: text('idempotency_key'),
    runAt: timestamp('run_at', { withTimezone: true }).notNull().defaultNow(),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    lockedBy: text('locked_by'),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    idempotencyUnique: unique('jobs_org_idempotency_unique').on(
      table.organizationId,
      table.idempotencyKey,
    ),
    claimIdx: index('jobs_claim_idx').on(table.status, table.runAt),
  }),
);

export const jobAttempts = pgTable('job_attempts', {
  id: uuid('id').defaultRandom().primaryKey(),
  jobId: uuid('job_id')
    .notNull()
    .references(() => jobs.id, { onDelete: 'cascade' }),
  attempt: integer('attempt').notNull(),
  succeeded: boolean('succeeded').notNull(),
  error: text('error'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }).notNull().defaultNow(),
});

export const dataExportRequests = pgTable('data_export_requests', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

export const dataDeletionRequests = pgTable('data_deletion_requests', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

export const mailboxCheckpoints = pgTable(
  'mailbox_checkpoints',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    emailAccountId: uuid('email_account_id')
      .notNull()
      .references(() => emailAccounts.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull().default('inbox'),
    cursor: text('cursor').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    accountKindUnique: unique('mailbox_checkpoints_account_kind_unique').on(
      table.emailAccountId,
      table.kind,
    ),
  }),
);

export const mailboxEvents = pgTable(
  'mailbox_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    emailAccountId: uuid('email_account_id')
      .notNull()
      .references(() => emailAccounts.id, { onDelete: 'cascade' }),
    historyId: text('history_id').notNull(),
    type: text('type').notNull(),
    providerMessageId: text('provider_message_id').notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // Duplicate Gmail history events must be idempotent.
    dedupeUnique: unique('mailbox_events_dedupe_unique').on(
      table.emailAccountId,
      table.historyId,
      table.type,
      table.providerMessageId,
    ),
  }),
);

export const emailThreads = pgTable(
  'email_threads',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    emailAccountId: uuid('email_account_id')
      .notNull()
      .references(() => emailAccounts.id, { onDelete: 'cascade' }),
    providerThreadId: text('provider_thread_id').notNull(),
    normalizedSubject: text('normalized_subject'),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    providerThreadUnique: unique('email_threads_account_provider_unique').on(
      table.emailAccountId,
      table.providerThreadId,
    ),
  }),
);

export const emailMessages = pgTable(
  'email_messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    emailAccountId: uuid('email_account_id')
      .notNull()
      .references(() => emailAccounts.id, { onDelete: 'cascade' }),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => emailThreads.id, { onDelete: 'cascade' }),
    providerMessageId: text('provider_message_id').notNull(),
    direction: text('direction').notNull(),
    subject: text('subject'),
    snippet: text('snippet'),
    // Ciphertext envelope from @echoloop/security; never plaintext.
    bodyTextEncrypted: text('body_text_encrypted'),
    messageIdHeader: text('message_id_header'),
    inReplyToHeader: text('in_reply_to_header'),
    referencesHeader: text('references_header'),
    labels: jsonb('labels')
      .notNull()
      .default(sql`'[]'::jsonb`),
    isBulk: boolean('is_bulk').notNull().default(false),
    isCalendar: boolean('is_calendar').notNull().default(false),
    contentHash: text('content_hash'),
    internalDate: timestamp('internal_date', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    providerMessageUnique: unique('email_messages_account_provider_unique').on(
      table.emailAccountId,
      table.providerMessageId,
    ),
    threadIdx: index('email_messages_thread_idx').on(table.threadId),
  }),
);

export const messageParticipants = pgTable(
  'message_participants',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    messageId: uuid('message_id')
      .notNull()
      .references(() => emailMessages.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    address: text('address').notNull(),
    displayName: text('display_name'),
  },
  (table) => ({
    messageIdx: index('message_participants_message_idx').on(table.messageId),
  }),
);

export const contacts = pgTable(
  'contacts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    address: text('address').notNull(),
    domain: text('domain'),
    displayName: text('display_name'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgAddressUnique: unique('contacts_org_address_unique').on(table.organizationId, table.address),
  }),
);

export const contactRelationships = pgTable('contact_relationships', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  contactId: uuid('contact_id')
    .notNull()
    .references(() => contacts.id, { onDelete: 'cascade' }),
  relationship: text('relationship').notNull(),
  // confirmed (human-set) vs inferred (AI-suggested) — never conflated.
  source: text('source').notNull().default('inferred'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const messageClassifications = pgTable(
  'message_classifications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    messageId: uuid('message_id')
      .notNull()
      .references(() => emailMessages.id, { onDelete: 'cascade' }),
    status: text('status').notNull(),
    exclusionReason: text('exclusion_reason'),
    // Validated TriageResult JSON (schema-checked before storage); null when excluded/failed.
    result: jsonb('result'),
    modelId: text('model_id'),
    promptVersion: text('prompt_version'),
    latencyMs: integer('latency_ms'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    messageUnique: unique('message_classifications_message_unique').on(table.messageId),
  }),
);

export const schema = {
  organizations,
  users,
  memberships,
  emailAccounts,
  auditEvents,
  jobs,
  jobAttempts,
  dataExportRequests,
  dataDeletionRequests,
  mailboxCheckpoints,
  mailboxEvents,
  emailThreads,
  emailMessages,
  messageParticipants,
  contacts,
  contactRelationships,
  messageClassifications,
};

export type Schema = typeof schema;
