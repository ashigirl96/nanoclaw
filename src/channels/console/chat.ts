import {
  createMessagingGroupAgent,
  createMessagingGroupIfAbsent,
  getMessagingGroupAgentByPair,
  getMessagingGroupByPlatform,
} from '../../db/messaging-groups.js';
import { upsertUser } from '../../modules/permissions/db/users.js';
import { grantRole, isOwner } from '../../modules/permissions/db/user-roles.js';
import type { ChannelDefaults } from '../adapter.js';

export const CHANNEL_TYPE = 'web';
export const OWNER_USER_ID = 'web:owner';

const CHAT: ChannelDefaults['dm'] = {
  engageMode: 'pattern',
  engagePattern: '.',
  threads: false,
  unknownSenderPolicy: 'strict',
};

export const CONSOLE_DEFAULTS: ChannelDefaults = { dm: CHAT, group: CHAT, mentions: 'never' };

export function platformIdFor(agentGroupId: string): string {
  return `${CHANNEL_TYPE}:${agentGroupId}`;
}

export function agentGroupIdFrom(platformId: string): string | null {
  const prefix = `${CHANNEL_TYPE}:`;
  return platformId.startsWith(prefix) ? platformId.slice(prefix.length) : null;
}

// The Console has no openDM, so ensureUserDm makes the handle of web:owner the platform id of the Owner's DM.
export const INBOX_PLATFORM_ID = OWNER_USER_ID.slice(CHANNEL_TYPE.length + 1);

export type ConsoleChat = { kind: 'inbox' } | { kind: 'agent-group'; agentGroupId: string };

export function chatOf(platformId: string): ConsoleChat | null {
  if (platformId === INBOX_PLATFORM_ID) return { kind: 'inbox' };
  const agentGroupId = agentGroupIdFrom(platformId);
  return agentGroupId === null ? null : { kind: 'agent-group', agentGroupId };
}

/** The store's key for a Chat, where null stands for the Inbox. */
export function storeKeyOf(chat: ConsoleChat): string | null {
  return chat.kind === 'inbox' ? null : chat.agentGroupId;
}

export function platformIdOfChat(agentGroupId: string | null): string {
  return agentGroupId === null ? INBOX_PLATFORM_ID : platformIdFor(agentGroupId);
}

export async function ensureOwner(): Promise<void> {
  const now = new Date().toISOString();
  await upsertUser({ id: OWNER_USER_ID, kind: CHANNEL_TYPE, display_name: 'Owner', created_at: now });
  if (await isOwner(OWNER_USER_ID)) return;
  await grantRole({ user_id: OWNER_USER_ID, role: 'owner', agent_group_id: null, granted_by: null, granted_at: now });
}

export async function ensureConsoleChat(agentGroupId: string): Promise<void> {
  await ensureOwner();
  const platformId = platformIdFor(agentGroupId);
  const now = new Date().toISOString();
  await createMessagingGroupIfAbsent({
    id: `mg-web-${agentGroupId}`,
    channel_type: CHANNEL_TYPE,
    platform_id: platformId,
    instance: CHANNEL_TYPE,
    name: null,
    is_group: 0,
    unknown_sender_policy: CHAT.unknownSenderPolicy,
    denied_at: null,
    created_at: now,
  });
  const mg = await getMessagingGroupByPlatform(CHANNEL_TYPE, platformId);
  if (!mg) throw new Error(`Console messaging group for ${agentGroupId} disappeared after insert`);
  if (await getMessagingGroupAgentByPair(mg.id, agentGroupId)) return;
  await createMessagingGroupAgent({
    id: `mga-web-${agentGroupId}`,
    messaging_group_id: mg.id,
    agent_group_id: agentGroupId,
    engage_mode: 'pattern',
    engage_pattern: CHAT.engagePattern!,
    sender_scope: 'all',
    ignored_message_policy: 'drop',
    session_mode: 'shared',
    priority: 0,
    created_at: now,
  });
}
