/**
 * post_question: a Question the Agent does not wait for. The Console renders it
 * as a card and turns the answer into an Owner Chat Message (ADR 0002); every
 * other Platform gets the Question as plain text.
 */
import { writeMessageOut } from '../db/messages-out.js';
import { getSessionRouting, resolveDestinationThread } from '../db/session-routing.js';
import { getCurrentReplyRoute } from '../db/session-state.js';
import { registerTools } from './server.js';
import type { McpToolDefinition } from './types.js';

const CONSOLE_CHANNEL = 'web';
const FIELD_TYPES = ['text', 'textarea', 'select', 'multi_select', 'date'] as const;
type FieldType = (typeof FIELD_TYPES)[number];

interface Option {
  label: string;
  selectedLabel: string;
  value: string;
}

interface Field {
  id: string;
  label: string;
  type: FieldType;
  options?: string[];
}

type Answerable = { options: Option[] } | { fields: Field[] };

function ok(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

function err(text: string) {
  return { content: [{ type: 'text' as const, text: `Error: ${text}` }], isError: true };
}

function generateId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseOptions(raw: unknown[]): Option[] | string {
  const options: Option[] = [];
  for (const o of raw) {
    if (typeof o === 'string' && o) {
      options.push({ label: o, selectedLabel: o, value: o });
      continue;
    }
    const obj = o as { label?: unknown; selectedLabel?: unknown; value?: unknown } | null;
    if (!obj || typeof obj.label !== 'string' || !obj.label) return 'each option needs a non-empty label';
    options.push({
      label: obj.label,
      selectedLabel: typeof obj.selectedLabel === 'string' && obj.selectedLabel ? obj.selectedLabel : obj.label,
      value: typeof obj.value === 'string' && obj.value ? obj.value : obj.label,
    });
  }
  if (new Set(options.map((o) => o.value)).size !== options.length) return 'option values must be unique';
  return options;
}

function parseFields(raw: unknown[]): Field[] | string {
  const fields: Field[] = [];
  for (const f of raw) {
    const obj = f as { id?: unknown; label?: unknown; type?: unknown; options?: unknown } | null;
    if (!obj || typeof obj.id !== 'string' || !obj.id) return 'each field needs a non-empty id';
    if (typeof obj.label !== 'string' || !obj.label) return `field ${obj.id} needs a non-empty label`;
    if (!FIELD_TYPES.includes(obj.type as FieldType)) {
      return `field ${obj.id} has type ${String(obj.type)}; use one of ${FIELD_TYPES.join(', ')}`;
    }
    const type = obj.type as FieldType;
    if (type === 'select' || type === 'multi_select') {
      const options = Array.isArray(obj.options) ? obj.options.filter((o) => typeof o === 'string' && o) : [];
      if (options.length === 0) return `field ${obj.id} is a ${type} and needs options`;
      fields.push({ id: obj.id, label: obj.label, type, options: options as string[] });
    } else {
      fields.push({ id: obj.id, label: obj.label, type });
    }
  }
  if (new Set(fields.map((f) => f.id)).size !== fields.length) return 'field ids must be unique';
  return fields;
}

function parseAnswerable(args: Record<string, unknown>): Answerable | string {
  const hasOptions = Array.isArray(args.options) && args.options.length > 0;
  const hasFields = Array.isArray(args.fields) && args.fields.length > 0;
  if (hasOptions === hasFields) return 'give either options or fields, not both';
  if (hasOptions) {
    const options = parseOptions(args.options as unknown[]);
    return typeof options === 'string' ? options : { options };
  }
  const fields = parseFields(args.fields as unknown[]);
  return typeof fields === 'string' ? fields : { fields };
}

function fieldLine(field: Field): string {
  if (field.type === 'select') return `- ${field.label} (one of: ${field.options!.join(' / ')})`;
  if (field.type === 'multi_select') return `- ${field.label} (any of: ${field.options!.join(' / ')})`;
  if (field.type === 'date') return `- ${field.label} (date, YYYY-MM-DD)`;
  return `- ${field.label}`;
}

/** The Question as text, for a Platform that has no card to answer it with. */
function asText(title: string, question: string, answerable: Answerable): string {
  const lines =
    'options' in answerable
      ? answerable.options.map((o, i) => `${String.fromCharCode(65 + (i % 26))}. ${o.label}`)
      : answerable.fields.map(fieldLine);
  return `*${title}*\n${question}\n\n${lines.join('\n')}`;
}

function routing() {
  const session = getSessionRouting();
  const thread =
    session.channel_type && session.platform_id
      ? resolveDestinationThread(session.channel_type, session.platform_id, getCurrentReplyRoute())
      : null;
  return { ...session, thread_id: thread?.threadId ?? session.thread_id };
}

const OPTION_SCHEMA = {
  oneOf: [
    { type: 'string' },
    {
      type: 'object',
      properties: { label: { type: 'string' }, selectedLabel: { type: 'string' }, value: { type: 'string' } },
      required: ['label'],
    },
  ],
};

const FIELD_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'Key for this field; unique within the form' },
    label: { type: 'string' },
    type: { type: 'string', enum: [...FIELD_TYPES] },
    options: {
      type: 'array',
      items: { type: 'string' },
      description: 'Choices for a select or multi_select field',
    },
  },
  required: ['id', 'label', 'type'],
};

export const postQuestion: McpToolDefinition = {
  tool: {
    name: 'post_question',
    description:
      'Post a Question to the user and return at once, without waiting. Give either options (the user picks one) or fields (a form with text, textarea, select, multi_select or date inputs). The answer arrives later, possibly days later, as an ordinary chat message from the user that starts with 「<title> — <question>」への答え.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Short title shown above the question' },
        question: { type: 'string', description: 'The question to ask' },
        options: {
          type: 'array',
          items: OPTION_SCHEMA,
          description: 'Choices to pick from (string or {label, selectedLabel?, value?}). Omit when giving fields.',
        },
        fields: { type: 'array', items: FIELD_SCHEMA, description: 'Form inputs. Omit when giving options.' },
      },
      required: ['title', 'question'],
    },
  },
  async handler(args) {
    const title = typeof args.title === 'string' ? args.title : '';
    const question = typeof args.question === 'string' ? args.question : '';
    if (!title || !question) return err('title and question are required');
    const answerable = parseAnswerable(args);
    if (typeof answerable === 'string') return err(answerable);

    const id = generateId();
    const r = routing();
    const onConsole = r.channel_type === CONSOLE_CHANNEL;
    await writeMessageOut({
      id,
      kind: onConsole ? 'chat-sdk' : 'chat',
      platform_id: r.platform_id,
      channel_type: r.channel_type,
      thread_id: r.thread_id,
      content: JSON.stringify(
        onConsole
          ? { type: 'post_question', questionId: id, title, question, ...answerable }
          : { text: asText(title, question, answerable) },
      ),
    });

    return ok(
      onConsole
        ? `Question posted (id: ${id}). Do not wait for it: the answer arrives later as a chat message from the user that starts with 「${title} — ${question}」への答え.`
        : `Question sent as text (id: ${id}); this chat has no Question cards. The user answers in an ordinary reply.`,
    );
  },
};

registerTools([postQuestion]);
