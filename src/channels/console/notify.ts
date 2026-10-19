import type { OutboundMessage } from '../adapter.js';
import { agentGroupIdFrom } from './chat.js';

export type NoticeKind = 'reply' | 'question' | 'approval';

/** What the browser announces when the Console tab is in the background. */
export interface Notice {
  kind: NoticeKind;
  /** null for the Inbox: an Approval Request goes to the Owner's DM, not to an Agent Group's Chat. */
  agentGroupId: string | null;
  body: string;
}

export function noticeFor(platformId: string, message: OutboundMessage): Notice | null {
  const content = (message.content ?? {}) as Record<string, unknown>;
  if (typeof content.operation === 'string') return null;
  const agentGroupId = agentGroupIdFrom(platformId);

  if (content.type === 'ask_question' || content.type === 'post_question') {
    const body = stringOr(content.question, stringOr(content.title, ''));
    return { kind: agentGroupId ? 'question' : 'approval', agentGroupId, body };
  }
  if (!agentGroupId) return null;

  const card = (content.card ?? {}) as Record<string, unknown>;
  const body =
    stringOr(content.markdown, '') ||
    stringOr(content.text, '') ||
    stringOr(card.title, '') ||
    stringOr(content.fallbackText, '') ||
    (message.files ?? []).map((f) => f.filename).join(', ');
  return { kind: 'reply', agentGroupId, body };
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}
