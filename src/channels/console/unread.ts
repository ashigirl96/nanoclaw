import { HttpError, type Route, type RouteContext, ok, requireAgentGroup } from './http.js';

export function broadcastUnread(ctx: Pick<RouteContext, 'store' | 'broadcast'>, agentGroupId: string): number {
  const unread = ctx.store.unreadCount(agentGroupId);
  ctx.broadcast({ type: 'unread', agentGroupId, unread });
  return unread;
}

export const readRoute: Route = async (route, ctx) => {
  const match = /^POST \/api\/agent-groups\/([^/]+)\/read$/.exec(route);
  if (!match) return null;
  const agentGroupId = await requireAgentGroup(decodeURIComponent(match[1]));
  const { messageId } = await ctx.readBody();
  if (typeof messageId !== 'string' || !ctx.store.markRead(agentGroupId, messageId)) {
    throw new HttpError(404, 'unknown message in this Chat');
  }
  return ok({ unread: broadcastUnread(ctx, agentGroupId) });
};
