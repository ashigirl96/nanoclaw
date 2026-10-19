import { getPendingQuestion } from '../../db/sessions.js';
import { resolveQuestionRender } from '../question-render-registry.js';
import { type Card, type ChoiceCard, choiceCardFrom, linkCardFrom } from './cards.js';
import { postedCardOf } from './posted-questions.js';

/** The card an Outbound Message carries, if any, plus the text the Chat list shows for it. */
export async function cardOf(content: Record<string, unknown>): Promise<{ card: Card; text: string } | null> {
  if (content.type === 'ask_question' && typeof content.questionId === 'string') {
    // delivery.ts records an Agent's Question before handing it to the adapter; Approval Requests skip that path.
    const isQuestion = (await getPendingQuestion(content.questionId)) !== undefined;
    const card = choiceCardFrom(content, isQuestion);
    return card && { card, text: card.question || card.title };
  }
  const posted = postedCardOf(content);
  if (posted) return { card: posted, text: posted.question || posted.title };
  const card = linkCardFrom(content);
  if (!card) return null;
  const fallback = typeof content.fallbackText === 'string' ? content.fallbackText : '';
  return { card, text: fallback || card.description || card.title };
}

/**
 * Where an answer goes:
 * - `action`: back to the Host through onAction; the card shows the answer right away.
 * - `deferred`: through onAction too, but the Host writes the result onto the card itself.
 * - `chat`: the Agent no longer waits, so the answer becomes an Owner Chat Message (ADR 0002).
 * - `expired`: an Approval Request the Host no longer holds.
 */
export type AnswerRoute = 'action' | 'deferred' | 'chat' | 'expired';

export async function answerRoute(card: ChoiceCard): Promise<AnswerRoute> {
  if (card.type === 'question') {
    const pending = await getPendingQuestion(card.questionId);
    return pending && isStillWaiting(pending.created_at) ? 'action' : 'chat';
  }
  const render = await resolveQuestionRender(card.questionId);
  if (!render) return 'expired';
  return render.deferResolution ? 'deferred' : 'action';
}

// ask_user_question waits 300s by default; the margin covers the delay between the Agent asking and the card arriving.
const AGENT_WAIT_MS = 290 * 1000;

function isStillWaiting(deliveredAt: string): boolean {
  return Date.now() - Date.parse(deliveredAt) < AGENT_WAIT_MS;
}

/** The Owner Chat Message that carries a late answer, naming the Question it answers. */
export function lateAnswerText(card: ChoiceCard, option: { label: string; value: string }): string {
  const picked = option.value === option.label ? option.label : `${option.label} (${option.value})`;
  const asked = [card.title, card.question].filter(Boolean).join(' — ');
  return `「${asked}」への答え: ${picked}`;
}
