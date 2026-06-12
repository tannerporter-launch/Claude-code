import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { exportPlaybook, playbookToMarkdown } from '@echoloop/correspondence';
import { createPgDatabase, organizations } from '@echoloop/database';
import { requireDatabaseUrl } from '@echoloop/schemas';

/**
 * USER-RUN CLI: export the active playbook to exports/ as Markdown + JSON.
 * Exports are snapshots, not authoritative sources (BUILD_BRIEF §6.2).
 *
 *   node apps/worker/dist/export-playbook.js
 */
async function main(): Promise<void> {
  const { db, close } = await createPgDatabase(requireDatabaseUrl());
  try {
    const [org] = await db.select().from(organizations).limit(1);
    if (!org) {
      console.log('No organization found.');
      return;
    }
    const playbook = await exportPlaybook(db, { organizationId: org.id });
    const dir = join(process.cwd(), 'exports');
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    writeFileSync(join(dir, `playbook-${stamp}.json`), JSON.stringify(playbook, null, 2));
    writeFileSync(join(dir, `playbook-${stamp}.md`), playbookToMarkdown(playbook));
    console.log(
      `Exported ${playbook.knowledge.length} knowledge documents and ` +
        `${playbook.rules.length} active rules to exports/playbook-${stamp}.{json,md}`,
    );
  } finally {
    await close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
