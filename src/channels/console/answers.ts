import { OWNER_USER_ID, platformIdOfChat } from './chat.js';
import { type FormCard, awaitsAnswer, isAnswerable } from './cards.js';
import { HttpError, type Route, type RouteContext, ok } from './http.js';
import { formAnswerOf } from './posted-questions.js';
import { answerDestination, lateAnswerText } from './questions.js';
import type { ChatMessage } from './store.js';
import { answerWaitingTool } from './waiting-tool.js';

const EXPIRED_RESOLUTION = '⏱️ もう受け付けていません';

export const answersRoute: Route = async (route, ctx) => {
  const match = /^POST \/api\/messages\/([^/]+)\/answer$/.exec(route);
  if (!match) return null;
  return ok(await answerCard(ctx, decodeURIComponent(match[1]), await ctx.readBody()));
};

async function answerCard(ctx: RouteContext, messageId: string, body: Record<string, unknown>): Promise<ChatMessage> {
  const message = ctx.store.getMessage(messageId);
  const card = message?.card;
  if (!message || !card || !isAnswerable(card)) throw new HttpError(404, 'no card takes answers here');
  if (card.type === 'form') return answerForm(ctx, message, card, body.values);
  const option = card.options.find((o) => o.value === body.value);
  if (!option) throw new HttpError(400, 'value must be one of the card options');
  if (card.resolution !== null) throw new HttpError(409, 'the card is already answered');

  const destination = await answerDestination(card);
  if (destination.kind !== 'deferred') {
    resolve(ctx, message, destination.kind === 'expired' ? EXPIRED_RESOLUTION : option.selectedLabel);
  }

  if (destination.kind === 'action' || destination.kind === 'deferred') {
    ctx.onAction(card.questionId, option.value, OWNER_USER_ID, {
      messageId: message.id,
      platformId: platformIdOfChat(message.agentGroupId),
    });
  } else if (destination.kind !== 'expired' && message.agentGroupId !== null) {
    const taken = destination.kind === 'tool' && (await answerWaitingTool(destination.pending, option.value));
    if (!taken) await ctx.sendFromOwner(message.agentGroupId, { text: lateAnswerText(card, option) });
  }
  return ctx.store.getMessage(message.id)!;
}

async function answerForm(
  ctx: RouteContext,
  message: ChatMessage,
  card: FormCard,
  values: unknown,
): Promise<ChatMessage> {
  if (card.resolution !== null) throw new HttpError(409, 'the card is already answered');
  const answer = formAnswerOf(card, values);
  if ('error' in answer) throw new HttpError(400, answer.error);
  const resolved = resolve(ctx, message, answer.resolution);
  if (message.agentGroupId !== null) await ctx.sendFromOwner(message.agentGroupId, { text: answer.text });
  return resolved;
}

function resolve(ctx: RouteContext, message: ChatMessage, resolution: string): ChatMessage {
  const resolved = ctx.store.updateCard(message.agentGroupId, message.id, (c) =>
    awaitsAnswer(c) ? { ...c, resolution } : null,
  );
  if (!resolved) throw new HttpError(409, 'the card is already answered');
  ctx.broadcast({ type: 'message', message: resolved });
  return resolved;
}
