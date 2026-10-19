import { AvatarImageError, toAvatarImage } from './avatar-image.js';
import { HttpError, type Route, ok, requireAgentGroup } from './http.js';
import { NoOwnSlackBotError } from './slack-avatar.js';
import type { ConsoleStore, Image } from './store.js';

const MAX_LABEL_CHARS = 40;

export interface AppearanceSummary {
  label: string | null;
  avatarUrl: string | null;
}

export function appearanceOf(store: ConsoleStore, agentGroupId: string): AppearanceSummary {
  const { label, avatar } = store.getAppearance(agentGroupId);
  const avatarUrl = avatar
    ? `/api/agent-groups/${encodeURIComponent(agentGroupId)}/avatar?v=${encodeURIComponent(avatar.updatedAt)}`
    : null;
  return { label, avatarUrl };
}

export const appearanceRoute: Route = async (route, ctx) => {
  const refetch = /^POST \/api\/agent-groups\/([^/]+)\/avatar\/slack$/.exec(route);
  if (refetch) {
    const agentGroupId = await requireAgentGroup(decodeURIComponent(refetch[1]));
    try {
      await ctx.slackAvatars.refresh(agentGroupId);
    } catch (err) {
      if (err instanceof NoOwnSlackBotError) throw new HttpError(409, err.message);
      throw new HttpError(502, err instanceof Error ? err.message : String(err));
    }
    return ok(appearanceOf(ctx.store, agentGroupId));
  }
  const match = /^(POST|DELETE) \/api\/agent-groups\/([^/]+)\/(label|avatar)$/.exec(route);
  if (!match) return null;
  const [, method, rawId, field] = match;
  const agentGroupId = await requireAgentGroup(decodeURIComponent(rawId));
  if (method === 'POST' && field === 'label') {
    ctx.store.setLabel(agentGroupId, parseLabel((await ctx.readBody()).label));
  } else if (method === 'POST' && field === 'avatar') {
    ctx.store.setAvatar(agentGroupId, 'upload', parseAvatar((await ctx.readBody()).data));
  } else if (method === 'DELETE' && field === 'avatar') {
    ctx.store.setAvatar(agentGroupId, 'upload', null);
  } else {
    return null;
  }
  ctx.broadcast({ type: 'agent-groups' });
  return ok(appearanceOf(ctx.store, agentGroupId));
};

function parseLabel(raw: unknown): string | null {
  if (typeof raw !== 'string') throw new HttpError(400, 'label must be a string');
  const label = raw.trim();
  if (/[\r\n]/.test(label)) throw new HttpError(400, 'label must be a single line');
  if ([...label].length > MAX_LABEL_CHARS)
    throw new HttpError(400, `label must be ${MAX_LABEL_CHARS} characters or fewer`);
  return label || null;
}

function parseAvatar(raw: unknown): Image {
  if (typeof raw !== 'string') throw new HttpError(400, 'data must be base64');
  try {
    return toAvatarImage(Buffer.from(raw, 'base64'));
  } catch (err) {
    if (err instanceof AvatarImageError) throw new HttpError(err.status, err.message);
    throw err;
  }
}
