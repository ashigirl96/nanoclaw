import type { OutboundMessage } from '../adapter.js';
import { type ConsoleChat, chatIdOf, speakerOf } from './chat.js';

export type NoticeKind = 'reply' | 'question' | 'approval';

export interface Notice {
  kind: NoticeKind;
  chatId: string;
  /** The Agent Group that sent it; null for the Inbox. */
  agentGroupId: string | null;
  body: string;
}

export function noticeFor(chat: ConsoleChat, message: OutboundMessage): Notice | null {
  const content = (message.content ?? {}) as Record<string, unknown>;
  if (typeof content.operation === 'string') return null;
  const chatId = chatIdOf(chat);
  const agentGroupId = speakerOf(chat);

  if (content.type === 'ask_question' || content.type === 'post_question') {
    const body = stringOr(content.question, stringOr(content.title, ''));
    return { kind: chat.kind === 'inbox' ? 'approval' : 'question', chatId, agentGroupId, body };
  }
  if (chat.kind === 'inbox') return null;

  const card = (content.card ?? {}) as Record<string, unknown>;
  const body =
    stringOr(content.markdown, '') ||
    stringOr(content.text, '') ||
    stringOr(card.title, '') ||
    stringOr(content.fallbackText, '') ||
    (message.files ?? []).map((f) => f.filename).join(', ');
  return { kind: 'reply', chatId, agentGroupId, body };
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}
