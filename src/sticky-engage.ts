import { withExistingMailboxSession } from './session-manager.js';
import type { Session } from './types.js';

// accumulate also creates sessions, so only a stored waking chat message proves a past mention.
export async function hasEngagedBefore(session: Session): Promise<boolean> {
  const root = await withExistingMailboxSession(session.agent_group_id, session.id, (mailbox) =>
    mailbox.getConversationRoot(),
  );
  return root !== undefined;
}
