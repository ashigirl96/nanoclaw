import { normalizeOptions, type NormalizedOption, type RawOption } from '../ask-question.js';

/** An Approval Request for the Approver, or a Question from the Agent; both answered by picking an option. */
export interface ChoiceCard {
  type: 'approval' | 'question';
  questionId: string;
  title: string;
  question: string;
  options: NormalizedOption[];
  /** What the card says once it is answered; null while it still takes an answer. */
  resolution: string | null;
}

export interface CardLink {
  label: string;
  url: string;
  style?: 'primary' | 'danger' | 'default';
}

export interface LinkCard {
  type: 'links';
  title: string;
  description: string;
  children: string[];
  links: CardLink[];
}

export type Card = ChoiceCard | LinkCard | FormCard;

export type AnswerableCard = ChoiceCard | FormCard;

export function isAnswerable(card: Card): card is AnswerableCard {
  return card.type !== 'links';
}

export function awaitsAnswer(card: Card): card is AnswerableCard {
  return isAnswerable(card) && card.resolution === null;
}

/** How an Owner Chat Message names the Question it answers. */
export function answerHeading(card: AnswerableCard): string {
  return `「${[card.title, card.question].filter(Boolean).join(' — ')}」への答え:`;
}

export const FORM_FIELD_TYPES = ['text', 'textarea', 'select', 'multi_select', 'date'] as const;

export interface FormField {
  id: string;
  label: string;
  type: (typeof FORM_FIELD_TYPES)[number];
  /** The choices of a select or multi_select field. */
  options?: string[];
}

/** A Question from post_question that asks for form inputs instead of one pick. */
export interface FormCard {
  type: 'form';
  questionId: string;
  title: string;
  question: string;
  fields: FormField[];
  /** The answered values, one `<label>: <value>` line per field; null while it still takes an answer. */
  resolution: string | null;
}

/** Reads an ask_question payload; `isQuestion` tells an Agent's Question from an Approval Request. */
export function choiceCardFrom(content: Record<string, unknown>, isQuestion: boolean): ChoiceCard | null {
  if (content.type !== 'ask_question' || typeof content.questionId !== 'string') return null;
  if (!Array.isArray(content.options)) return null;
  return {
    type: isQuestion ? 'question' : 'approval',
    questionId: content.questionId,
    title: typeof content.title === 'string' ? content.title : '',
    question: typeof content.question === 'string' ? content.question : '',
    options: normalizeOptions(content.options as RawOption[]),
    resolution: null,
  };
}

/** Reads a send_card payload, keeping only http(s) links since they render as anchors. */
export function linkCardFrom(content: Record<string, unknown>): LinkCard | null {
  if (content.type !== 'card' || !content.card || typeof content.card !== 'object') return null;
  const spec = content.card as Record<string, unknown>;
  const children = Array.isArray(spec.children)
    ? spec.children
        .map((c: unknown) =>
          typeof c === 'string' ? c : c && typeof c === 'object' ? (c as { text?: unknown }).text : undefined,
        )
        .filter((t): t is string => typeof t === 'string' && t !== '')
    : [];
  const links = Array.isArray(spec.actions)
    ? spec.actions.flatMap((a: unknown): CardLink[] => {
        if (!a || typeof a !== 'object') return [];
        const { label, url, style } = a as Record<string, unknown>;
        if (typeof label !== 'string' || !label || typeof url !== 'string' || !isWebUrl(url)) return [];
        const safeStyle = style === 'primary' || style === 'danger' || style === 'default' ? style : undefined;
        return [{ label, url, ...(safeStyle && { style: safeStyle }) }];
      })
    : [];
  return {
    type: 'links',
    title: typeof spec.title === 'string' ? spec.title : '',
    description: typeof spec.description === 'string' ? spec.description : '',
    children,
    links,
  };
}

function isWebUrl(raw: string): boolean {
  try {
    const { protocol } = new URL(raw);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}
