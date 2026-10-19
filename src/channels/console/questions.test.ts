import fs from 'fs';
import os from 'os';
import path from 'path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sessionsRoot = vi.hoisted(() => `${process.env.TMPDIR ?? '/tmp'}/console-questions-${process.pid}`);
vi.mock('../../config.js', async () => {
  const actual = await vi.importActual<typeof import('../../config.js')>('../../config.js');
  return { ...actual, DATA_DIR: sessionsRoot };
});

import type { ChannelSetup, InboundMessage } from '../adapter.js';
import { closeDb, initTestDb, runMigrations } from '../../db/index.js';
import { createAgentGroup } from '../../db/agent-groups.js';
import { createPendingQuestion, createSession, deletePendingQuestion } from '../../db/sessions.js';
import { inboundDbPath, outboundDbPath } from '../../mailbox/sqlite/paths.js';
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

/** What ask_user_question in the Container sees when it polls for the answer now. */
function pollAnswer(questionId: string): { id: string; selectedOption: string } | null {
  const inbound = new Database(inboundDbPath('ag-a', 'sess-1'), { readonly: true });
  const outbound = new Database(outboundDbPath('ag-a', 'sess-1'));
  try {
    const row = inbound
      .prepare("SELECT id, content FROM messages_in WHERE status = 'pending' AND content LIKE ?")
      .get(`%"questionId":"${questionId}"%`) as { id: string; content: string } | undefined;
    if (!row || outbound.prepare('SELECT 1 FROM processing_ack WHERE message_id = ?').get(row.id)) return null;
    return { id: row.id, selectedOption: (JSON.parse(row.content) as { selectedOption: string }).selectedOption };
  } finally {
    inbound.close();
    outbound.close();
  }
}

/** ask_user_question still blocking in the Container: takes the answer once it shows up, as the tool does. */
async function waitingTool(questionId: string): Promise<string | null> {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const answer = fs.existsSync(inboundDbPath('ag-a', 'sess-1')) ? pollAnswer(questionId) : null;
    if (answer) {
      const outbound = new Database(outboundDbPath('ag-a', 'sess-1'));
      outbound
        .prepare("INSERT INTO processing_ack (message_id, status, status_changed) VALUES (?, 'completed', ?)")
        .run(answer.id, new Date().toISOString());
      outbound.close();
      return answer.selectedOption;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

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
  fs.rmSync(sessionsRoot, { recursive: true, force: true });
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
    const tool = waitingTool('q-1');

    await answer(card.id, 'ship');

    expect(await tool).toBe('ship');
    expect(inbound).toEqual([]);
    expect(actions).toEqual([]);
    expect((await history()).at(-1)!.card).toMatchObject({ resolution: '🚀 Shipping' });
  });

  it('returns the answer to a tool that was given more than 300 seconds to wait', async () => {
    const card = await askQuestion(new Date(Date.now() - 10 * 60 * 1000));
    const tool = waitingTool('q-1');

    await answer(card.id, 'ship');

    expect(await tool).toBe('ship');
    expect(inbound).toEqual([]);
  });

  it('sends the answer as an Owner Chat Message naming the Question once the tool stopped waiting', async () => {
    // ask_user_question gave up early (a short timeout, or the turn was cancelled), so nothing takes the answer.
    const card = await askQuestion(new Date());

    await answer(card.id, 'ship');

    expect(inbound).toHaveLength(1);
    expect(inbound[0].platformId).toBe('web:ag-a');
    expect(inbound[0].message.content).toMatchObject({ senderId: 'web:owner' });
    const text = (inbound[0].message.content as { text: string }).text;
    expect(text).toContain('Deploy to production now?');
    expect(text).toContain('Ship it');
    expect(pollAnswer('q-1')).toBeNull();
    const messages = await history();
    expect(messages.map((m) => m.role)).toEqual(['agent', 'owner']);
    expect(messages[0].card).toMatchObject({ resolution: '🚀 Shipping' });
  }, 15_000);

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
