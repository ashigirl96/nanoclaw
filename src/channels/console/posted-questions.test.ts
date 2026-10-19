import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChannelSetup, InboundMessage } from '../adapter.js';
import { closeDb, initTestDb, runMigrations } from '../../db/index.js';
import { createAgentGroup } from '../../db/agent-groups.js';
import { createConsoleAdapter, type ConsoleAdapter } from './adapter.js';
import { noticeFor } from './notify.js';

let tmp: string;
let adapter: ConsoleAdapter;
let inbound: Array<{ platformId: string; message: InboundMessage }>;
let actions: string[];

const recorder: ChannelSetup = {
  onInbound: (platformId, _threadId, message) => {
    inbound.push({ platformId, message });
  },
  onInboundEvent: () => {},
  onMetadata: () => {},
  onAction: (questionId) => {
    actions.push(questionId);
  },
};

interface ChatMessage {
  id: string;
  role: 'owner' | 'agent';
  text: string;
  card: { type: string; resolution: string | null } | null;
}

async function boot(): Promise<void> {
  adapter = createConsoleAdapter({ port: 0, dataDir: tmp, distDir: tmp });
  await adapter.setup(recorder);
}

async function request(pathname: string, init?: RequestInit): Promise<Response> {
  return fetch(adapter.url() + pathname, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
}

async function api<T = unknown>(pathname: string, init?: RequestInit): Promise<T> {
  const res = await request(pathname, init);
  if (!res.ok) throw new Error(`${pathname} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

const history = () => api<ChatMessage[]>('/api/agent-groups/ag-a/messages');
const answerStatus = async (messageId: string, body: unknown) =>
  (await request(`/api/messages/${messageId}/answer`, { method: 'POST', body: JSON.stringify(body) })).status;
const answer = (messageId: string, body: unknown) =>
  api<ChatMessage>(`/api/messages/${messageId}/answer`, { method: 'POST', body: JSON.stringify(body) });
const textsSent = () => inbound.map((i) => (i.message.content as { text: string }).text);

async function post(content: Record<string, unknown>): Promise<ChatMessage> {
  await adapter.deliver('web:ag-a', null, {
    kind: 'chat-sdk',
    content: { type: 'post_question', questionId: 'msg-1', ...content },
  });
  return (await history()).at(-1)!;
}

const choice = {
  title: 'Lunch',
  question: 'Where should we eat?',
  options: [
    { label: 'Sushi', selectedLabel: '🍣 Sushi', value: 'sushi' },
    { label: 'Ramen', selectedLabel: 'Ramen', value: 'Ramen' },
    { label: 'Curry', selectedLabel: 'Curry', value: 'Curry' },
  ],
};

const form = {
  title: 'Order',
  question: 'What do you want?',
  fields: [
    { id: 'name', label: 'Name', type: 'text' },
    { id: 'notes', label: 'Notes', type: 'textarea' },
    { id: 'size', label: 'Size', type: 'select', options: ['S', 'M', 'L'] },
    { id: 'toppings', label: 'Toppings', type: 'multi_select', options: ['Egg', 'Nori', 'Corn'] },
    { id: 'when', label: 'When', type: 'date' },
  ],
};

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'console-posted-questions-test-'));
  inbound = [];
  actions = [];
  const db = await initTestDb();
  await runMigrations(db);
  await createAgentGroup({
    id: 'ag-a',
    name: 'Alice',
    folder: 'alice',
    agent_provider: null,
    created_at: '2026-10-01T00:00:00.000Z',
  });
  await boot();
});

afterEach(async () => {
  vi.useRealTimers();
  await adapter.teardown();
  await closeDb();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('a Question with options from post_question', () => {
  it('shows its options in order', async () => {
    const message = await post(choice);

    expect(message.text).toBe('Where should we eat?');
    expect(message.card).toMatchObject({
      type: 'question',
      resolution: null,
      options: [
        { label: 'Sushi', value: 'sushi' },
        { label: 'Ramen', value: 'Ramen' },
        { label: 'Curry', value: 'Curry' },
      ],
    });
  });

  it('delivers the pick as an Owner Chat Message and closes the card', async () => {
    const message = await post(choice);

    await answer(message.id, { value: 'Ramen' });

    expect(actions).toEqual([]);
    expect(inbound.map((i) => i.platformId)).toEqual(['web:ag-a']);
    expect(inbound[0].message.content).toMatchObject({ senderId: 'web:owner' });
    expect(textsSent()).toEqual(['「Lunch — Where should we eat?」への答え: Ramen']);
    const [card, reply] = await history();
    expect(card.card).toMatchObject({ resolution: 'Ramen' });
    expect(reply).toMatchObject({ role: 'owner', text: '「Lunch — Where should we eat?」への答え: Ramen' });
    expect(await answerStatus(message.id, { value: 'Curry' })).toBe(409);
    expect(inbound).toHaveLength(1);
  });

  it('still delivers an answer given days later, after the Console restarted', async () => {
    const message = await post(choice);
    await adapter.teardown();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 3 * 24 * 60 * 60 * 1000);
    await boot();

    await answer(message.id, { value: 'sushi' });

    expect(textsSent()).toEqual(['「Lunch — Where should we eat?」への答え: Sushi (sushi)']);
    expect((await history())[0].card).toMatchObject({ resolution: '🍣 Sushi' });
  });
});

describe('a form from post_question', () => {
  it('shows its fields', async () => {
    const message = await post(form);

    expect(message.card).toEqual({
      type: 'form',
      questionId: 'msg-1',
      title: 'Order',
      question: 'What do you want?',
      fields: form.fields,
      resolution: null,
    });
  });

  it('delivers every field value in one Owner Chat Message and shows the answer on the card', async () => {
    const message = await post(form);

    await answer(message.id, {
      values: {
        name: 'Alice',
        notes: 'No onions\nExtra hot',
        size: 'M',
        toppings: ['Egg', 'Corn'],
        when: '2026-10-21',
      },
    });

    const expected = [
      'Name: Alice',
      'Notes: No onions\nExtra hot',
      'Size: M',
      'Toppings: Egg, Corn',
      'When: 2026-10-21',
    ].join('\n');
    expect(textsSent()).toEqual([`「Order — What do you want?」への答え:\n${expected}`]);
    expect((await history())[0].card).toMatchObject({ resolution: expected });
    expect(await answerStatus(message.id, { values: { name: 'Bob' } })).toBe(409);
  });

  it('marks the fields left empty', async () => {
    const message = await post(form);

    await answer(message.id, { values: { name: 'Alice' } });

    expect(textsSent()[0]).toBe(
      '「Order — What do you want?」への答え:\n' +
        'Name: Alice\nNotes: (未入力)\nSize: (未入力)\nToppings: (未入力)\nWhen: (未入力)',
    );
  });

  it.each([
    ['values that are not an object', { values: 'Alice' }],
    ['a select value that is not an option', { values: { size: 'XL' } }],
    ['a multi-select value that is not an option', { values: { toppings: ['Egg', 'Ham'] } }],
    ['a multi-select value that is not a list', { values: { toppings: 'Egg' } }],
    ['a date that is not YYYY-MM-DD', { values: { when: 'next Tuesday' } }],
    ['a text value that is not a string', { values: { name: 42 } }],
  ])('refuses %s and keeps the form open', async (_name, body) => {
    const message = await post(form);

    expect(await answerStatus(message.id, body)).toBe(400);

    expect(inbound).toEqual([]);
    expect((await history())[0].card).toMatchObject({ resolution: null });
  });
});

describe('the notification for a posted Question', () => {
  it('announces it as a Question in the Agent Group', () => {
    expect(
      noticeFor('web:ag-a', { kind: 'chat-sdk', content: { type: 'post_question', questionId: 'msg-1', ...form } }),
    ).toEqual({ kind: 'question', agentGroupId: 'ag-a', body: 'What do you want?' });
  });
});
