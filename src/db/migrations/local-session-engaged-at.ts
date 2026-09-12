import type { Migration } from './index.js';

/**
 * FORK-LOCAL — not upstream. Named and numbered outside upstream's sequence so
 * a merge never has to rename a file, a symbol, or a version to take both
 * sides. `version` is only an ordering hint; applied identity is `name`.
 *
 * This one belongs in the barrel rather than behind `registerMigration()`,
 * despite being local: it adds a column to a CORE table that core code writes
 * unconditionally (`createSession`). Module migrations are optional by
 * contract — they run only when their module is loaded — and the standalone
 * entry points that migrate a database (`scripts/migrate.ts`,
 * `setup/register.ts`, `setup/migrate-v2/*.ts`) never import the modules
 * barrel. Registering there yields a `sessions` table with no `engaged_at`
 * and a hard failure on the next insert.
 *
 * `sessions.engaged_at` — the timestamp of the first wake this session was
 * created for, or NULL for a session that only ever held accumulated context.
 *
 * `mention-sticky` used to read session existence as its subscription state,
 * which held only while engagement was the sole path that created a session.
 * `ignored_message_policy='accumulate'` is a second path: it resolves a
 * session so it has somewhere to write trigger=0 rows, without ever waking
 * the agent. A thread's first non-mention message therefore minted the very
 * row sticky read as proof of a past mention, and every follow-up engaged.
 *
 * Deliberately no backfill. Nothing in the central DB distinguishes a session
 * that engaged from one that only accumulated, and any proxy would preserve
 * exactly the spurious subscriptions this column exists to end. Every session
 * starts NULL: threads that were following without a mention stop, and
 * genuinely sticky threads resume on their next mention.
 */
export const localSessionEngagedAt: Migration = {
  version: 1000,
  name: 'local:session-engaged-at',
  async up(db) {
    await db.exec(`ALTER TABLE sessions ADD COLUMN engaged_at TEXT;`);
  },
};
