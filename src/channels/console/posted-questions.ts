import { type ChoiceCard, type FormCard, type FormField, choiceCardFrom } from './cards.js';

const FIELD_TYPES: ReadonlySet<string> = new Set(['text', 'textarea', 'select', 'multi_select', 'date']);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMPTY = '(未入力)';

/**
 * The card for a post_question payload. Its options become a Question card that no
 * pending_questions row backs, so every answer takes the Chat Message route (ADR 0002).
 */
export function postedCardOf(content: Record<string, unknown>): ChoiceCard | FormCard | null {
  if (content.type !== 'post_question' || typeof content.questionId !== 'string') return null;
  if (Array.isArray(content.options)) return choiceCardFrom({ ...content, type: 'ask_question' }, true);
  if (!Array.isArray(content.fields)) return null;
  return {
    type: 'form',
    questionId: content.questionId,
    title: typeof content.title === 'string' ? content.title : '',
    question: typeof content.question === 'string' ? content.question : '',
    fields: content.fields.flatMap(fieldFrom),
    resolution: null,
  };
}

function fieldFrom(raw: unknown): FormField[] {
  const f = raw as Record<string, unknown> | null;
  if (!f || typeof f.id !== 'string' || typeof f.label !== 'string' || !FIELD_TYPES.has(f.type as string)) return [];
  const type = f.type as FormField['type'];
  if (type !== 'select' && type !== 'multi_select') return [{ id: f.id, label: f.label, type }];
  const options = Array.isArray(f.options) ? f.options.filter((o): o is string => typeof o === 'string') : [];
  return [{ id: f.id, label: f.label, type, options }];
}

export type FormAnswer = { resolution: string; text: string } | { error: string };

/** Checks the submitted values against the form and words the answer; a missing value counts as left empty. */
export function formAnswerOf(card: FormCard, rawValues: unknown): FormAnswer {
  if (!rawValues || typeof rawValues !== 'object' || Array.isArray(rawValues)) {
    return { error: 'values must be an object keyed by field id' };
  }
  const values = rawValues as Record<string, unknown>;
  const lines: string[] = [];
  for (const field of card.fields) {
    const shown = valueOf(field, values[field.id]);
    if (typeof shown !== 'string') return shown;
    lines.push(`${field.label}: ${shown || EMPTY}`);
  }
  const resolution = lines.join('\n');
  const asked = [card.title, card.question].filter(Boolean).join(' — ');
  return { resolution, text: `「${asked}」への答え:\n${resolution}` };
}

function valueOf(field: FormField, value: unknown): string | { error: string } {
  if (value === undefined || value === null) return '';
  if (field.type === 'multi_select') {
    if (!Array.isArray(value)) return { error: `${field.id} must be a list` };
    const unknown = value.find((v) => typeof v !== 'string' || !field.options!.includes(v));
    if (unknown !== undefined) return { error: `${field.id} has a value that is not one of its options` };
    return value.join(', ');
  }
  if (typeof value !== 'string') return { error: `${field.id} must be a string` };
  if (value === '') return '';
  if (field.type === 'select' && !field.options!.includes(value)) {
    return { error: `${field.id} must be one of its options` };
  }
  if (field.type === 'date' && !DATE.test(value)) return { error: `${field.id} must be a date as YYYY-MM-DD` };
  return value;
}
