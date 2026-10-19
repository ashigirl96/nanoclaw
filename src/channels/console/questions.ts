import { getPendingQuestion } from '../../db/sessions.js';
import { type Card, choiceCardFrom, linkCardFrom } from './cards.js';

/** The card an Outbound Message carries, if any, plus the text the Chat list shows for it. */
export async function cardOf(content: Record<string, unknown>): Promise<{ card: Card; text: string } | null> {
  if (content.type === 'ask_question' && typeof content.questionId === 'string') {
    // delivery.ts records an Agent's Question before handing it to the adapter; Approval Requests skip that path.
    const isQuestion = (await getPendingQuestion(content.questionId)) !== undefined;
    const card = choiceCardFrom(content, isQuestion);
    return card && { card, text: card.question || card.title };
  }
  const card = linkCardFrom(content);
  if (!card) return null;
  const fallback = typeof content.fallbackText === 'string' ? content.fallbackText : '';
  return { card, text: fallback || card.description || card.title };
}
