import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ChannelSetup, InboundMessage } from '../adapter.js';
import { closeDb, initTestDb, runMigrations } from '../../db/index.js';
import { createAgentGroup } from '../../db/agent-groups.js';
import { createPendingQuestion, createSession, deletePendingQuestion } from '../../db/sessions.js';
import { createConsoleAdapter, type ConsoleAdapter } from './adapter.js';

let tmp: string;
let adapter: ConsoleAdapter;
let inbound: Array<{ platformId: string; message: InboundMessage }>;
let actions: Array<{ questionId: string; value: string; userId: string; messageId?: string; platformId?: string }>;

function recorder(): ChannelSetup {
  return {
    onInbound: (platformId, _threadId, message) => {
      inbound.push({ platformId, message });
    },
    onInboundEvent: () => {},
    onMetadata: () => {},
    onAction: (questionId, value, userId, address) => {
      actions.push({ questionId, value, userId, messageId: address?.messageId, platformId: address?.platformId });
    },
  };
}

interface ChatMessage {
  id: string;
  role: 'owner' | 'agent';
  text: string;
  card: { type: string; resolution: string | null; options: Array<{ label: string; value: string }> } | null;
}

async function api<T = unknown>(pathname: string, init?: RequestInit): Promise<T> {
  const res = await fetch(adapter.url() + pathname, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  if (!res.ok) throw new Error(`${pathname} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

const history = () => api<ChatMessage[]>('/api/agent-groups/ag-a/messages');
const answer = (messageId: string, value: string) =>
  api<ChatMessage>(`/api/messages/${messageId}/answer`, { method: 'POST', body: JSON.stringify({ value }) });

/** Delivers an Agent's Question the way delivery.ts does: the pending row first, then the card. */
async function askQuestion(askedAt: Date): Promise<ChatMessage> {
  await createPendingQuestion({
    question_id: 'q-1',
    session_id: 'sess-1',
    message_out_id: 'out-1',
    platform_id: 'web:ag-a',
    channel_type: 'web',
    thread_id: null,
    title: 'Deploy',
    options: [
      { label: 'Ship it', selectedLabel: '🚀 Shipping', value: 'ship' },
      { label: 'Wait', selectedLabel: 'Wait', value: 'Wait' },
    ],
    created_at: askedAt.toISOString(),
  });
  await adapter.deliver('web:ag-a', null, {
    kind: 'chat-sdk',
    content: {
      type: 'ask_question',
      questionId: 'q-1',
      title: 'Deploy',
      question: 'Deploy to production now?',
      options: [{ label: 'Ship it', selectedLabel: '🚀 Shipping', value: 'ship' }, 'Wait'],
    },
  });
  return (await history()).at(-1)!;
}

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'console-questions-test-'));
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
  const now = new Date().toISOString();
  await createSession({
    id: 'sess-1',
    agent_group_id: 'ag-a',
    messaging_group_id: null,
    thread_id: null,
    agent_provider: null,
    status: 'active',
    container_status: 'running',
    last_active: now,
    created_at: now,
  });
  adapter = createConsoleAdapter({ port: 0, dataDir: tmp, distDir: tmp });
  await adapter.setup(recorder());
});

afterEach(async () => {
  await adapter.teardown();
  await closeDb();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('a Question from ask_user_question', () => {
  it('shows in the Chat with its options', async () => {
    const card = await askQuestion(new Date());

    expect(card.card).toMatchObject({ type: 'question', resolution: null });
    expect(card.card!.options.map((o) => [o.label, o.value])).toEqual([
      ['Ship it', 'ship'],
      ['Wait', 'Wait'],
    ]);
  });

  it('returns the answer as the tool result while the Agent waits', async () => {
    const card = await askQuestion(new Date());

    await answer(card.id, 'ship');

    expect(actions).toEqual([
      { questionId: 'q-1', value: 'ship', userId: 'web:owner', messageId: card.id, platformId: 'web:ag-a' },
    ]);
    expect(inbound).toEqual([]);
    expect((await history()).at(-1)!.card).toMatchObject({ resolution: '🚀 Shipping' });
  });

  it('sends a late answer as an Owner Chat Message naming the Question', async () => {
    const card = await askQuestion(new Date(Date.now() - 10 * 60 * 1000));

    await answer(card.id, 'ship');

    expect(actions).toEqual([]);
    expect(inbound).toHaveLength(1);
    expect(inbound[0].platformId).toBe('web:ag-a');
    expect(inbound[0].message.content).toMatchObject({ senderId: 'web:owner' });
    const text = (inbound[0].message.content as { text: string }).text;
    expect(text).toContain('Deploy to production now?');
    expect(text).toContain('Ship it');
    const messages = await history();
    expect(messages.map((m) => m.role)).toEqual(['agent', 'owner']);
    expect(messages[0].card).toMatchObject({ resolution: '🚀 Shipping' });
  });

  it('sends the answer as a Chat Message once the Host no longer tracks the Question', async () => {
    const card = await askQuestion(new Date());
    await deletePendingQuestion('q-1');

    await answer(card.id, 'Wait');

    expect(actions).toEqual([]);
    expect((inbound[0].message.content as { text: string }).text).toContain('Wait');
  });

  it('refuses a value that is not one of the options', async () => {
    const card = await askQuestion(new Date());

    await expect(answer(card.id, 'maybe')).rejects.toThrow(/400/);
    expect(actions).toEqual([]);
  });
});

describe('a card from send_card', () => {
  it('shows its text and web links as link buttons', async () => {
    await adapter.deliver('web:ag-a', null, {
      kind: 'chat-sdk',
      content: {
        type: 'card',
        card: {
          title: 'Release v2',
          description: 'The release is out.',
          children: ['3 fixes', { text: '1 feature' }],
          actions: [
            { label: 'Changelog', url: 'https://example.com/changelog', style: 'primary' },
            { label: 'Script', url: 'javascript:alert(1)' },
            { label: 'Approve', value: 'approve' },
          ],
        },
        fallbackText: 'Release v2 is out',
      },
    });

    const [message] = await history();
    expect(message.text).toBe('Release v2 is out');
    expect(message.card).toEqual({
      type: 'links',
      title: 'Release v2',
      description: 'The release is out.',
      children: ['3 fixes', '1 feature'],
      links: [{ label: 'Changelog', url: 'https://example.com/changelog', style: 'primary' }],
    });
  });

  it('takes no answers', async () => {
    await adapter.deliver('web:ag-a', null, {
      kind: 'chat-sdk',
      content: { type: 'card', card: { title: 'Note' } },
    });
    const [message] = await history();

    await expect(answer(message.id, 'anything')).rejects.toThrow(/404/);
  });
});
