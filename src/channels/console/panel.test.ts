import fs from 'fs';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ROOT = vi.hoisted(() => `/tmp/nanoclaw-console-panel-test-${process.pid}`);

vi.mock('../../config.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../config.js')>()),
  GROUPS_DIR: `${ROOT}/groups`,
  DATA_DIR: `${ROOT}/data`,
  TEMPLATES_DIR: `${ROOT}/templates`,
}));

vi.mock('../../log.js', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() },
}));

import type { ChannelSetup } from '../adapter.js';
import { closeDb, initTestDb, runMigrations } from '../../db/index.js';
import { createAgentGroup } from '../../db/agent-groups.js';
import { createMessagingGroup, getMessagingGroupsByAgentGroup } from '../../db/messaging-groups.js';
import { getPendingApproval } from '../../db/sessions.js';
import { setDeliveryAdapter } from '../../delivery.js';
import { upsertUserDm } from '../../modules/permissions/db/user-dms.js';
import { grantRole } from '../../modules/permissions/db/user-roles.js';
import { upsertUser } from '../../modules/permissions/db/users.js';
import { createScheduledTask, prepareScheduledTask } from '../../modules/scheduling/create.js';
import { appendRunLog } from '../../modules/scheduling/run-log.js';
import { getResponseHandlers, type ResponsePayload } from '../../response-registry.js';
import { PLUGIN_SCHEMA_URL } from '../../templates/manifest.js';
import { createConsoleAdapter, type ConsoleAdapter } from './adapter.js';

let adapter: ConsoleAdapter | null = null;

function setupRecorder(): ChannelSetup {
  return { onInbound: () => {}, onInboundEvent: () => {}, onMetadata: () => {}, onAction: () => {} };
}

async function start(): Promise<ConsoleAdapter> {
  adapter = createConsoleAdapter({ port: 0, dataDir: `${ROOT}/data`, distDir: `${ROOT}/dist` });
  await adapter.setup(setupRecorder());
  return adapter;
}

async function call(pathname: string, init?: RequestInit): Promise<Response> {
  return fetch(adapter!.url() + pathname, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
}

async function api<T = unknown>(pathname: string, init?: RequestInit): Promise<T> {
  const res = await call(pathname, init);
  if (!res.ok) throw new Error(`${pathname} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

beforeEach(async () => {
  fs.rmSync(ROOT, { recursive: true, force: true });
  fs.mkdirSync(`${ROOT}/data`, { recursive: true });
  const db = await initTestDb();
  await runMigrations(db);
  await createAgentGroup({
    id: 'ag-a',
    name: 'Alice',
    folder: 'alice',
    agent_provider: null,
    created_at: '2026-10-01T00:00:00.000Z',
  });
  await createAgentGroup({
    id: 'ag-b',
    name: 'Bob',
    folder: 'bob',
    agent_provider: null,
    created_at: '2026-10-02T00:00:00.000Z',
  });
});

afterEach(async () => {
  await adapter?.teardown();
  adapter = null;
  await closeDb();
  fs.rmSync(ROOT, { recursive: true, force: true });
});

interface LibraryItem {
  id: string;
  name: string;
  mimeType: string;
  createdAt: string;
}

describe('Library', () => {
  it('lists the files the Agent delivered to its Chat, newest first, and opens them', async () => {
    const consoleAdapter = await start();
    await consoleAdapter.deliver('web:ag-a', null, {
      kind: 'chat',
      content: { text: 'first' },
      files: [{ filename: 'plan.md', data: Buffer.from('# plan') }],
    });
    await consoleAdapter.deliver('web:ag-a', null, {
      kind: 'chat',
      content: { text: 'second' },
      files: [
        { filename: 'chart.png', data: Buffer.from('png-bytes') },
        { filename: 'report.pdf', data: Buffer.from('pdf-bytes') },
      ],
    });

    const library = await api<LibraryItem[]>('/api/agent-groups/ag-a/library');

    expect(library.map((f) => [f.name, f.mimeType])).toEqual([
      ['report.pdf', 'application/pdf'],
      ['chart.png', 'image/png'],
      ['plan.md', 'text/markdown; charset=utf-8'],
    ]);
    const opened = await call(`/api/files/${library[2].id}`);
    expect(await opened.text()).toBe('# plan');
  });

  it("leaves out the Owner's attachments and other Agents' files", async () => {
    const consoleAdapter = await start();
    await api('/api/agent-groups/ag-a/messages', {
      method: 'POST',
      body: JSON.stringify({ files: [{ name: 'mine.txt', mimeType: 'text/plain', data: 'aGk=' }] }),
    });
    await consoleAdapter.deliver('web:ag-b', null, {
      kind: 'chat',
      content: { text: '' },
      files: [{ filename: 'bob.txt', data: Buffer.from('bob') }],
    });

    expect(await api('/api/agent-groups/ag-a/library')).toEqual([]);
  });
});

interface Routine {
  seriesId: string;
  prompt: string;
  status: string;
  schedule: string;
  nextRun: string;
  lastRun: string | null;
  runs: number;
  failedRuns: number;
  lastResult: string | null;
}

describe('Routine', () => {
  it("lists the Agent Group's Tasks with their schedule, next run, and last result", async () => {
    const daily = await createScheduledTask(
      'ag-a',
      prepareScheduledTask({
        name: 'briefing',
        prompt: 'Send the morning briefing.',
        recurrence: '0 9 * * *',
        timezone: 'UTC',
      }),
    );
    await createScheduledTask(
      'ag-a',
      prepareScheduledTask({ prompt: 'Remind me once.', processAfter: '2099-01-01T00:00:00Z', timezone: 'UTC' }),
      { status: 'paused' },
    );
    await createScheduledTask(
      'ag-b',
      prepareScheduledTask({ prompt: 'Not Alice.', processAfter: '2099-01-01T00:00:00Z', timezone: 'UTC' }),
    );
    await appendRunLog('ag-a', daily.row.id, 'sent the briefing to #general');
    await start();

    const routines = await api<Routine[]>('/api/agent-groups/ag-a/routines');

    expect(routines).toEqual([
      {
        seriesId: daily.row.id,
        prompt: 'Send the morning briefing.',
        status: 'pending',
        schedule: '0 9 * * *',
        nextRun: daily.row.processAfter,
        lastRun: null,
        runs: 0,
        failedRuns: 0,
        lastResult: expect.stringContaining('sent the briefing to #general'),
      },
      expect.objectContaining({
        prompt: 'Remind me once.',
        status: 'paused',
        schedule: 'once',
        nextRun: '2099-01-01T00:00:00.000Z',
        lastResult: null,
      }),
    ]);
  });

  it('offers no way to change a Task', async () => {
    await start();

    const res = await call('/api/agent-groups/ag-a/routines', { method: 'POST', body: '{}' });

    expect(res.status).toBe(404);
  });
});

interface Delivered {
  channelType: string;
  platformId: string;
  kind: string;
  content: Record<string, unknown>;
}

function writeTemplate(ref: string, description: string): void {
  const dir = path.join(ROOT, 'templates', ref);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'plugin.json'),
    JSON.stringify({ $schema: PLUGIN_SCHEMA_URL, name: path.basename(ref), description }),
  );
}

function recordDeliveries(): Delivered[] {
  const delivered: Delivered[] = [];
  setDeliveryAdapter({
    deliver: async (channelType, platformId, _threadId, kind, content) => {
      delivered.push({ channelType, platformId, kind, content: JSON.parse(content) as Record<string, unknown> });
      return 'card-1';
    },
  });
  return delivered;
}

/** What the Host does with a button press on a card: the first response handler that claims it wins. */
async function press(payload: Omit<ResponsePayload, 'threadId'>): Promise<void> {
  for (const handler of getResponseHandlers()) {
    if (await handler({ ...payload, threadId: null })) return;
  }
  throw new Error(`no response handler claimed ${payload.questionId}`);
}

async function sidebarNames(): Promise<string[]> {
  return (await api<Array<{ name: string }>>('/api/agent-groups')).map((g) => g.name);
}

describe('creating an Agent with "+"', () => {
  beforeEach(() => writeTemplate('research/analyst', 'Digs into a topic.'));

  it('offers the Templates on this machine', async () => {
    await start();

    expect(await api('/api/templates')).toEqual([
      { ref: 'research/analyst', name: 'analyst', description: 'Digs into a topic.' },
    ]);
  });

  it('creates the Agent Group from the Template when the Owner asks, and shows it in the sidebar', async () => {
    await start();
    await api('/api/agent-groups/ag-a/open', { method: 'POST', body: '{}' });
    const events = await openEvents();

    const result = await api<{ status: string; agentGroup: { id: string; name: string } }>('/api/agent-groups', {
      method: 'POST',
      body: JSON.stringify({ template: 'research/analyst', name: 'Researcher' }),
    });

    expect(result).toMatchObject({ status: 'created', agentGroup: { name: 'Researcher' } });
    expect(await sidebarNames()).toEqual(['Alice', 'Bob', 'Researcher']);
    expect(await events.next(1)).toEqual([{ type: 'agent-groups' }]);
    events.close();
  });

  it('does not give the new Agent a Slack bot or any other Chat', async () => {
    await start();
    await api('/api/agent-groups/ag-a/open', { method: 'POST', body: '{}' });

    const { agentGroup } = await api<{ agentGroup: { id: string } }>('/api/agent-groups', {
      method: 'POST',
      body: JSON.stringify({ template: 'research/analyst', name: 'Researcher' }),
    });

    expect(await getMessagingGroupsByAgentGroup(agentGroup.id)).toEqual([]);
  });

  it('refuses a Template that is not on this machine', async () => {
    await start();
    await api('/api/agent-groups/ag-a/open', { method: 'POST', body: '{}' });

    const res = await call('/api/agent-groups', {
      method: 'POST',
      body: JSON.stringify({ template: 'missing/one', name: 'Ghost' }),
    });

    expect(res.status).toBe(400);
    expect(await sidebarNames()).toEqual(['Alice', 'Bob']);
  });

  describe('when the Guard holds the request', () => {
    // web:owner without the Owner role: the Guard holds and core picks the Approver.
    beforeEach(async () => {
      const now = new Date().toISOString();
      await upsertUser({ id: 'slack:U1', kind: 'slack', display_name: 'Sam', created_at: now });
      await grantRole({ user_id: 'slack:U1', role: 'owner', agent_group_id: null, granted_by: null, granted_at: now });
      await createMessagingGroup({
        id: 'mg-dm-sam',
        channel_type: 'slack',
        platform_id: 'slack:D1',
        instance: 'slack',
        name: 'Sam',
        is_group: 0,
        unknown_sender_policy: 'strict',
        denied_at: null,
        created_at: now,
      });
      await upsertUserDm({
        user_id: 'slack:U1',
        channel_type: 'slack',
        messaging_group_id: 'mg-dm-sam',
        resolved_at: now,
      });
    });

    async function requestResearcher() {
      const res = await call('/api/agent-groups', {
        method: 'POST',
        body: JSON.stringify({ template: 'research/analyst', name: 'Researcher' }),
      });
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    }

    it("sends an Approval Request to the Approver's DM and creates nothing yet", async () => {
      const delivered = recordDeliveries();
      await start();

      const res = await requestResearcher();

      expect(res).toEqual({ status: 202, body: { status: 'held' } });
      expect(await sidebarNames()).toEqual(['Alice', 'Bob']);
      expect(delivered).toEqual([
        {
          channelType: 'slack',
          platformId: 'slack:D1',
          kind: 'chat-sdk',
          content: expect.objectContaining({
            type: 'ask_question',
            questionId: expect.any(String),
            question: expect.stringContaining('Researcher'),
          }),
        },
      ]);
      expect(await getPendingApproval(delivered[0].content.questionId as string)).toMatchObject({
        approver_user_id: 'slack:U1',
      });
    });

    it('creates the Agent Group once the Approver approves', async () => {
      const delivered = recordDeliveries();
      await start();
      await requestResearcher();
      const questionId = delivered[0].content.questionId as string;

      await press({ questionId, value: 'approve', userId: 'U1', channelType: 'slack', platformId: 'slack:D1' });

      expect(await sidebarNames()).toEqual(['Alice', 'Bob', 'Researcher']);
      expect(await getPendingApproval(questionId)).toBeUndefined();
    });

    it('creates nothing when the Approver rejects', async () => {
      const delivered = recordDeliveries();
      await start();
      await requestResearcher();
      const questionId = delivered[0].content.questionId as string;

      await press({ questionId, value: 'reject', userId: 'U1', channelType: 'slack', platformId: 'slack:D1' });

      expect(await sidebarNames()).toEqual(['Alice', 'Bob']);
      expect(await getPendingApproval(questionId)).toBeUndefined();
    });

    it('ignores a press from someone who is not the Approver', async () => {
      const delivered = recordDeliveries();
      await start();
      await requestResearcher();
      const questionId = delivered[0].content.questionId as string;

      await press({ questionId, value: 'approve', userId: 'owner', channelType: 'web', platformId: 'web:owner' });

      expect(await sidebarNames()).toEqual(['Alice', 'Bob']);
      expect(await getPendingApproval(questionId)).toBeDefined();
    });
  });
});

async function openEvents() {
  const controller = new AbortController();
  const res = await fetch(adapter!.url() + '/api/events', { signal: controller.signal });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const received: unknown[] = [];
  return {
    async next(count: number): Promise<unknown[]> {
      while (received.length < count) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const data = frame
            .split('\n')
            .filter((l) => l.startsWith('data: '))
            .map((l) => l.slice(6))
            .join('\n');
          if (data) received.push(JSON.parse(data));
        }
      }
      return received.slice(0, count);
    },
    close: () => controller.abort(),
  };
}
