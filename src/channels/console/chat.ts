import {
  createMessagingGroupAgent,
  createMessagingGroupIfAbsent,
  getMessagingGroupAgentByPair,
  getMessagingGroupByPlatform,
} from '../../db/messaging-groups.js';
import { upsertUser } from '../../modules/permissions/db/users.js';
import { grantRole, isOwner } from '../../modules/permissions/db/user-roles.js';
import type { MessagingGroup, MessagingGroupAgent } from '../../types.js';
import type { ChannelDefaults } from '../adapter.js';

export const CHANNEL_TYPE = 'web';
export const OWNER_USER_ID = 'web:owner';

const CHAT: ChannelDefaults['dm'] = {
  engageMode: 'pattern',
  engagePattern: '.',
  threads: false,
  unknownSenderPolicy: 'strict',
};

export const GROUP_CHAT: ChannelDefaults['group'] = {
  engageMode: 'mention',
  threads: false,
  unknownSenderPolicy: 'strict',
};

export const CONSOLE_DEFAULTS: ChannelDefaults = { dm: CHAT, group: GROUP_CHAT, mentions: 'platform' };

export function platformIdFor(agentGroupId: string): string {
  return `${CHANNEL_TYPE}:${agentGroupId}`;
}

/** Each participant of a Group Chat has its own Messaging Group (ADR 0003). */
export function groupChatPlatformId(groupChatId: string, agentGroupId: string): string {
  return `${CHANNEL_TYPE}:gc:${groupChatId}:${agentGroupId}`;
}

const GROUP_CHAT_PLATFORM_ID = new RegExp(`^${CHANNEL_TYPE}:gc:([^:]+):(.+)$`);

// The Console has no openDM, so ensureUserDm makes the handle of web:owner the platform id of the Owner's DM.
export const INBOX_PLATFORM_ID = OWNER_USER_ID.slice(CHANNEL_TYPE.length + 1);

/** The Chat a platform id points at; for a Group Chat, also the participant it addresses. */
export type ConsoleChat =
  | { kind: 'inbox' }
  | { kind: 'agent-group'; agentGroupId: string }
  | { kind: 'group-chat'; groupChatId: string; agentGroupId: string };

export function chatOf(platformId: string): ConsoleChat | null {
  if (platformId === INBOX_PLATFORM_ID) return { kind: 'inbox' };
  const groupChat = GROUP_CHAT_PLATFORM_ID.exec(platformId);
  if (groupChat) return { kind: 'group-chat', groupChatId: groupChat[1], agentGroupId: groupChat[2] };
  const prefix = `${CHANNEL_TYPE}:`;
  return platformId.startsWith(prefix) ? { kind: 'agent-group', agentGroupId: platformId.slice(prefix.length) } : null;
}

export const INBOX_CHAT_ID = 'inbox';

export function chatIdOfAgentGroup(agentGroupId: string): string {
  return `ag:${agentGroupId}`;
}

export function chatIdOfGroupChat(groupChatId: string): string {
  return `gc:${groupChatId}`;
}

/** The key the store and the browser use for a Chat. */
export function chatIdOf(chat: ConsoleChat): string {
  if (chat.kind === 'inbox') return INBOX_CHAT_ID;
  return chat.kind === 'agent-group' ? chatIdOfAgentGroup(chat.agentGroupId) : chatIdOfGroupChat(chat.groupChatId);
}

/** The Agent Group whose Outbound Messages arrive on this platform id; null for the Inbox. */
export function speakerOf(chat: ConsoleChat): string | null {
  return chat.kind === 'inbox' ? null : chat.agentGroupId;
}

export function agentGroupIdOfChat(chatId: string): string | null {
  return chatId.startsWith('ag:') ? chatId.slice(3) : null;
}

export function groupChatIdOfChat(chatId: string): string | null {
  return chatId.startsWith('gc:') ? chatId.slice(3) : null;
}

/** Where an Agent's message in this Chat came from, so an answer to it goes back the same way. */
export function platformIdOfMessage(message: { chatId: string; agentGroupId: string | null }): string {
  const groupChatId = groupChatIdOfChat(message.chatId);
  if (groupChatId !== null && message.agentGroupId !== null) {
    return groupChatPlatformId(groupChatId, message.agentGroupId);
  }
  const agentGroupId = agentGroupIdOfChat(message.chatId);
  return agentGroupId === null ? INBOX_PLATFORM_ID : platformIdFor(agentGroupId);
}

export async function ensureOwner(): Promise<void> {
  const now = new Date().toISOString();
  await upsertUser({ id: OWNER_USER_ID, kind: CHANNEL_TYPE, display_name: 'Owner', created_at: now });
  if (await isOwner(OWNER_USER_ID)) return;
  await grantRole({ user_id: OWNER_USER_ID, role: 'owner', agent_group_id: null, granted_by: null, granted_at: now });
}

export async function ensureConsoleChat(agentGroupId: string): Promise<void> {
  const now = new Date().toISOString();
  await ensureWired(
    {
      id: `mg-web-${agentGroupId}`,
      channel_type: CHANNEL_TYPE,
      platform_id: platformIdFor(agentGroupId),
      instance: CHANNEL_TYPE,
      name: null,
      is_group: 0,
      unknown_sender_policy: CHAT.unknownSenderPolicy,
      denied_at: null,
      created_at: now,
    },
    {
      id: `mga-web-${agentGroupId}`,
      agent_group_id: agentGroupId,
      engage_mode: CHAT.engageMode,
      engage_pattern: CHAT.engagePattern!,
      sender_scope: 'all',
      ignored_message_policy: 'drop',
      session_mode: 'shared',
      priority: 0,
      created_at: now,
    },
  );
}

/** Creates the Messaging Group and the Agent Group's Wiring on it, keeping whichever already exists. */
export async function ensureWired(
  mg: MessagingGroup,
  wiring: Omit<MessagingGroupAgent, 'messaging_group_id'>,
): Promise<void> {
  await ensureOwner();
  await createMessagingGroupIfAbsent(mg);
  const stored = await getMessagingGroupByPlatform(mg.channel_type, mg.platform_id);
  if (!stored) throw new Error(`Console messaging group ${mg.platform_id} disappeared after insert`);
  if (await getMessagingGroupAgentByPair(stored.id, wiring.agent_group_id)) return;
  await createMessagingGroupAgent({ ...wiring, messaging_group_id: stored.id });
}
