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
import { createScheduledTask, prepareScheduledTask } from '../../modules/scheduling/create.js';
import { appendRunLog } from '../../modules/scheduling/run-log.js';
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
