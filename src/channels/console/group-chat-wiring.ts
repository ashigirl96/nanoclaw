import { isContainerRunning, killContainer } from '../../container-runner.js';
import { getDb, hasTable } from '../../db/connection.js';
import {
  deleteMessagingGroupAgent,
  getMessagingGroupAgentByPair,
  getMessagingGroupByPlatform,
  getMessagingGroupsByChannel,
} from '../../db/messaging-groups.js';
import { log } from '../../log.js';
import { CHANNEL_TYPE, GROUP_CHAT, ensureWired, groupChatPlatformId } from './chat.js';

export async function wireGroupChatMember(
  groupChat: { id: string; name: string },
  agentGroupId: string,
): Promise<void> {
  const now = new Date().toISOString();
  await ensureWired(
    {
      id: `mg-web-gc-${groupChat.id}-${agentGroupId}`,
      channel_type: CHANNEL_TYPE,
      platform_id: groupChatPlatformId(groupChat.id, agentGroupId),
      instance: CHANNEL_TYPE,
      name: groupChat.name,
      is_group: 1,
      unknown_sender_policy: GROUP_CHAT.unknownSenderPolicy,
      denied_at: null,
      created_at: now,
    },
    {
      id: `mga-web-gc-${groupChat.id}-${agentGroupId}`,
      agent_group_id: agentGroupId,
      engage_mode: GROUP_CHAT.engageMode,
      engage_pattern: null,
      sender_scope: 'all',
      // Messages that do not name the Agent still reach its Session as context.
      ignored_message_policy: 'accumulate',
      session_mode: 'shared',
      priority: 0,
      created_at: now,
    },
  );
}

/** Leaves the Messaging Group and its Session, so the Agent keeps what it saw there. */
export async function unwireGroupChatMember(groupChatId: string, agentGroupId: string): Promise<void> {
  const mg = await getMessagingGroupByPlatform(CHANNEL_TYPE, groupChatPlatformId(groupChatId, agentGroupId));
  if (!mg) return;
  const wiring = await getMessagingGroupAgentByPair(mg.id, agentGroupId);
  if (wiring) await deleteMessagingGroupAgent(wiring.id);
  const db = getDb();
  if (await hasTable(db, 'agent_destinations')) {
    await db.run(
      "DELETE FROM agent_destinations WHERE agent_group_id = ? AND target_type = 'channel' AND target_id = ?",
      agentGroupId,
      mg.id,
    );
  }
}

/**
 * Removes every Messaging Group the Group Chat ever had, with the Sessions on them, which
 * reference the Messaging Group. The Session folders stay on disk.
 */
export async function dismantleGroupChat(groupChatId: string): Promise<void> {
  const prefix = groupChatPlatformId(groupChatId, '');
  const mgs = (await getMessagingGroupsByChannel(CHANNEL_TYPE)).filter((mg) => mg.platform_id.startsWith(prefix));
  if (mgs.length === 0) return;
  const db = getDb();
  const hasDestinations = await hasTable(db, 'agent_destinations');
  const hasApprovals = await hasTable(db, 'pending_approvals');
  const mgIds = mgs.map((mg) => mg.id);
  const marks = mgIds.map(() => '?').join(', ');
  const sessions = await db.all<{ id: string }>(
    `SELECT id FROM sessions WHERE messaging_group_id IN (${marks})`,
    ...mgIds,
  );
  for (const session of sessions) {
    if (isContainerRunning(session.id)) killContainer(session.id, 'Group Chat deleted');
  }

  const inSessions = `SELECT id FROM sessions WHERE messaging_group_id IN (${marks})`;
  await db.transaction(async () => {
    await db.run(`DELETE FROM pending_questions WHERE session_id IN (${inSessions})`, ...mgIds);
    if (hasApprovals) await db.run(`DELETE FROM pending_approvals WHERE session_id IN (${inSessions})`, ...mgIds);
    await db.run(`DELETE FROM sessions WHERE messaging_group_id IN (${marks})`, ...mgIds);
    await db.run(`DELETE FROM messaging_group_agents WHERE messaging_group_id IN (${marks})`, ...mgIds);
    if (hasDestinations) {
      await db.run(
        `DELETE FROM agent_destinations WHERE target_type = 'channel' AND target_id IN (${marks})`,
        ...mgIds,
      );
    }
    await db.run(`DELETE FROM pending_sender_approvals WHERE messaging_group_id IN (${marks})`, ...mgIds);
    await db.run(`DELETE FROM pending_channel_approvals WHERE messaging_group_id IN (${marks})`, ...mgIds);
    await db.run(`DELETE FROM user_dms WHERE messaging_group_id IN (${marks})`, ...mgIds);
    await db.run(`DELETE FROM messaging_groups WHERE id IN (${marks})`, ...mgIds);
  });
  log.info('Console deleted a Group Chat', { groupChatId, messagingGroups: mgIds.length, sessions: sessions.length });
}
