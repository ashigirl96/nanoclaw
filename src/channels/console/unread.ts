import { chatIdOfAgentGroup } from './chat.js';
import { HttpError, type Route, type RouteContext, ok, requireAgentGroup } from './http.js';

export function broadcastUnread(ctx: Pick<RouteContext, 'store' | 'broadcast'>, chatId: string): number {
  const unread = ctx.store.unreadCount(chatId);
  ctx.broadcast({ type: 'unread', chatId, unread });
  return unread;
}

export async function markReadIn(ctx: RouteContext, chatId: string): Promise<{ unread: number }> {
  const { messageId } = await ctx.readBody();
  if (typeof messageId !== 'string' || !ctx.store.markRead(chatId, messageId)) {
    throw new HttpError(404, 'unknown message in this Chat');
  }
  return { unread: broadcastUnread(ctx, chatId) };
}

export const readRoute: Route = async (route, ctx) => {
  const match = /^POST \/api\/agent-groups\/([^/]+)\/read$/.exec(route);
  if (!match) return null;
  const agentGroupId = await requireAgentGroup(decodeURIComponent(match[1]));
  return ok(await markReadIn(ctx, chatIdOfAgentGroup(agentGroupId)));
};
