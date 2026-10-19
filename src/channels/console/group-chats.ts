import { randomUUID } from 'crypto';

import { getAgentGroup } from '../../db/agent-groups.js';
import type { Activity } from './activity.js';
import { chatIdOfGroupChat } from './chat.js';
import { dismantleGroupChat, unwireGroupChatMember, wireGroupChatMember } from './group-chat-wiring.js';
import { HttpError, type Route, type RouteContext, ok, requireAgentGroup } from './http.js';
import type { Mentionable } from './mentions.js';
import type { ChatMessage, ConsoleStore, GroupChat } from './store.js';
import { markReadIn } from './unread.js';

const MIN_MEMBERS = 2;

export interface GroupChatSummary {
  id: string;
  chatId: string;
  name: string;
  members: Mentionable[];
  lastMessage: ChatMessage | null;
  unread: number;
  /** Keyed by the participant's Agent Group id. */
  activity: Record<string, Activity>;
}

/** Participants whose Agent Group still exists; `ncl groups delete` does not know about Group Chats. */
export async function groupChatMembers(store: ConsoleStore, groupChatId: string): Promise<Mentionable[]> {
  const members: Mentionable[] = [];
  for (const id of store.groupChatMembers(groupChatId)) {
    const group = await getAgentGroup(id);
    if (group) members.push({ id: group.id, name: group.name });
  }
  return members;
}

export const groupChatsRoute: Route = async (route, ctx) => {
  if (route === 'GET /api/group-chats') {
    const summaries = [];
    for (const chat of ctx.store.listGroupChats()) summaries.push(await summaryOf(ctx, chat));
    return ok(summaries);
  }
  if (route === 'POST /api/group-chats') return ok(await create(ctx));

  const member = /^(POST|DELETE) \/api\/group-chats\/([^/]+)\/members(?:\/([^/]+))?$/.exec(route);
  if (member) {
    const [, method, rawId, rawAgentGroupId] = member;
    const chat = requireGroupChat(ctx, decodeURIComponent(rawId));
    if (method === 'POST' && !rawAgentGroupId) {
      const { agentGroupId } = await ctx.readBody();
      if (typeof agentGroupId !== 'string') throw new HttpError(400, 'agentGroupId is required');
      await addMember(ctx, chat, await requireAgentGroup(agentGroupId));
    } else if (method === 'DELETE' && rawAgentGroupId) {
      await removeMember(ctx, chat, decodeURIComponent(rawAgentGroupId));
    } else {
      return null;
    }
    ctx.broadcast({ type: 'group-chats' });
    return ok(await summaryOf(ctx, chat));
  }

  const match = /^(GET|POST|DELETE) \/api\/group-chats\/([^/]+)(?:\/(messages|read))?$/.exec(route);
  if (!match) return null;
  const [, method, rawId, action] = match;
  const chat = requireGroupChat(ctx, decodeURIComponent(rawId));
  const chatId = chatIdOfGroupChat(chat.id);
  if (method === 'DELETE' && !action) {
    await dismantleGroupChat(chat.id);
    ctx.store.deleteGroupChat(chat.id);
    ctx.broadcast({ type: 'group-chats' });
    return ok({ deleted: chat.id });
  }
  if (method === 'GET' && action === 'messages') return ok(ctx.store.listMessages(chatId));
  if (method === 'POST' && action === 'messages') return ok(await ctx.sendFromOwner(chatId, await ctx.readBody()));
  if (method === 'POST' && action === 'read') return ok(await markReadIn(ctx, chatId));
  return null;
};

async function create(ctx: RouteContext): Promise<GroupChatSummary> {
  const body = await ctx.readBody();
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) throw new HttpError(400, 'name is required');
  const raw = Array.isArray(body.agentGroupIds) ? body.agentGroupIds : [];
  const agentGroupIds = [...new Set(raw.filter((id): id is string => typeof id === 'string'))];
  if (agentGroupIds.length < MIN_MEMBERS) {
    throw new HttpError(400, `a Group Chat needs at least ${MIN_MEMBERS} Agent Groups`);
  }
  for (const id of agentGroupIds) await requireAgentGroup(id);

  const chat = ctx.store.createGroupChat(randomUUID(), name, agentGroupIds);
  for (const id of agentGroupIds) await wireGroupChatMember(chat, id);
  ctx.broadcast({ type: 'group-chats' });
  return summaryOf(ctx, chat);
}

async function addMember(ctx: RouteContext, chat: GroupChat, agentGroupId: string): Promise<void> {
  await wireGroupChatMember(chat, agentGroupId);
  ctx.store.addGroupChatMember(chat.id, agentGroupId);
}

async function removeMember(ctx: RouteContext, chat: GroupChat, agentGroupId: string): Promise<void> {
  const members = ctx.store.groupChatMembers(chat.id);
  if (!members.includes(agentGroupId)) throw new HttpError(404, `${agentGroupId} is not in this Group Chat`);
  if (members.length <= MIN_MEMBERS) {
    throw new HttpError(409, `a Group Chat keeps at least ${MIN_MEMBERS} Agent Groups; delete it instead`);
  }
  await unwireGroupChatMember(chat.id, agentGroupId);
  ctx.store.removeGroupChatMember(chat.id, agentGroupId);
}

function requireGroupChat(ctx: RouteContext, id: string): GroupChat {
  const chat = ctx.store.getGroupChat(id);
  if (!chat) throw new HttpError(404, `unknown Group Chat ${id}`);
  return chat;
}

async function summaryOf(ctx: RouteContext, chat: GroupChat): Promise<GroupChatSummary> {
  const chatId = chatIdOfGroupChat(chat.id);
  const members = await groupChatMembers(ctx.store, chat.id);
  return {
    id: chat.id,
    chatId,
    name: chat.name,
    members,
    lastMessage: ctx.store.lastMessage(chatId),
    unread: ctx.store.unreadCount(chatId),
    activity: Object.fromEntries(members.map((m) => [m.id, ctx.activityOf(chatId, m.id)])),
  };
}
