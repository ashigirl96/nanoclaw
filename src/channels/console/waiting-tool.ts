import { setTimeout as sleep } from 'timers/promises';

import { deletePendingQuestion, getSession } from '../../db/sessions.js';
import { withExistingMailboxSession, writeSessionMessage } from '../../session-manager.js';
import type { PendingQuestion, Session } from '../../types.js';
import { OWNER_USER_ID } from './chat.js';

// ask_user_question polls once a second, so an answer it is still waiting for is taken well within this.
const TAKE_WINDOW_MS = 5000;
const POLL_MS = 250;

/** Hands the answer to the blocking ask_user_question call; false when the call had already stopped waiting. */
export async function answerWaitingTool(pending: PendingQuestion, value: string): Promise<boolean> {
  await deletePendingQuestion(pending.question_id);
  const session = await getSession(pending.session_id);
  if (!session) return false;

  const id = `qr-${pending.question_id}-${Date.now()}`;
  await writeSessionMessage(session.agent_group_id, session.id, {
    id,
    kind: 'system',
    timestamp: new Date().toISOString(),
    platformId: pending.platform_id,
    channelType: pending.channel_type,
    threadId: pending.thread_id,
    content: JSON.stringify({
      type: 'question_response',
      questionId: pending.question_id,
      selectedOption: value,
      userId: OWNER_USER_ID,
    }),
    // Only the blocking tool reads this row; as a trigger it would wake the Container with nothing to do.
    trigger: false,
  });

  const deadline = Date.now() + TAKE_WINDOW_MS;
  while (Date.now() < deadline) {
    if (await wasTaken(session, id)) return true;
    await sleep(POLL_MS);
  }
  // A failed row is invisible to the tool, so a call that wakes up late cannot take the answer a second time.
  await withExistingMailboxSession(session.agent_group_id, session.id, (mailbox) => mailbox.markMessageFailed(id));
  return wasTaken(session, id);
}

async function wasTaken(session: Session, messageId: string): Promise<boolean> {
  const taken = await withExistingMailboxSession(session.agent_group_id, session.id, (mailbox) =>
    mailbox.getTerminalProcessingAcks().some((ack) => ack.messageId === messageId && ack.status === 'completed'),
  );
  return taken ?? false;
}
