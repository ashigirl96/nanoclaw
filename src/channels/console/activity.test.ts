import fs from 'fs';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sessionsRoot = vi.hoisted(() => `${process.env.TMPDIR ?? '/tmp'}/console-activity-${process.pid}`);
vi.mock('../../config.js', async () => {
  const actual = await vi.importActual<typeof import('../../config.js')>('../../config.js');
  return { ...actual, DATA_DIR: sessionsRoot };
});

import { createSession } from '../../db/sessions.js';
import { outboundDbPath } from '../../mailbox/sqlite/paths.js';
import { initSessionFolder, withMailboxSession } from '../../session-manager.js';
import { ActivityBoard } from './activity.js';
import { type Harness, startConsole, stopConsole } from './test-harness.js';

interface Summary {
  id: string;
  activity: { working: boolean; tool: string | null };
}

let h: Harness;

beforeEach(async () => {
  h = await startConsole();
});

afterEach(async () => {
  await stopConsole();
  fs.rmSync(sessionsRoot, { recursive: true, force: true });
});

/** The Console Chat's Session with its Mailbox; returns the path of its outbound DB. */
async function consoleSession(agentGroupId: string): Promise<string> {
  await h.api(`/api/agent-groups/${agentGroupId}/open`, { method: 'POST' });
  const sessionId = `sess-${agentGroupId}`;
  await createSession({
    id: sessionId,
    agent_group_id: agentGroupId,
    messaging_group_id: `mg-web-${agentGroupId}`,
    thread_id: null,
    agent_provider: null,
    status: 'active',
    container_status: 'running',
    last_active: null,
    created_at: new Date().toISOString(),
  });
  initSessionFolder(agentGroupId, sessionId);
  await withMailboxSession(agentGroupId, sessionId, () => undefined);
  return outboundDbPath(agentGroupId, sessionId);
}

/** The Console Chat's Session, with the Agent in the middle of running `tool`. */
async function runningTool(agentGroupId: string, tool: string): Promise<void> {
  const outbound = new Database(await consoleSession(agentGroupId));
  outbound
    .prepare(
      `INSERT INTO container_state (id, current_tool, tool_declared_timeout_ms, tool_started_at, updated_at)
       VALUES (1, ?, NULL, ?, ?)`,
    )
    .run(tool, '2026-10-19 00:00:00', '2026-10-19 00:00:00');
  outbound.close();
}

describe('working indicator', () => {
  it('marks the Agent Group as working while the Host keeps calling setTyping', async () => {
    const events = await h.openEvents();

    await h.adapter.setTyping!('web:ag-a', null);

    expect(await events.ofType('activity', 1)).toEqual([
      { type: 'activity', chatId: 'ag:ag-a', agentGroupId: 'ag-a', activity: { working: true, tool: null } },
    ]);
    const groups = await h.api<Summary[]>('/api/agent-groups');
    expect(groups.map((g) => [g.id, g.activity])).toEqual([
      ['ag-a', { working: true, tool: null }],
      ['ag-b', { working: false, tool: null }],
    ]);
    events.close();
  });

  it('names the tool the Agent is running in the Console Chat', async () => {
    await runningTool('ag-a', 'WebSearch');
    const events = await h.openEvents();

    await h.adapter.setTyping!('web:ag-a', null);

    expect(await events.ofType('activity', 1)).toEqual([
      { type: 'activity', chatId: 'ag:ag-a', agentGroupId: 'ag-a', activity: { working: true, tool: 'WebSearch' } },
    ]);
    events.close();
  });

  it('keeps the mark through a message the Agent sends before its turn ends', async () => {
    const outbound = new Database(await consoleSession('ag-a'));
    outbound
      .prepare("INSERT INTO processing_ack (message_id, status, status_changed) VALUES ('in-1', 'processing', ?)")
      .run(new Date().toISOString());
    outbound.close();
    await h.adapter.setTyping!('web:ag-a', null);

    await h.adapter.deliver('web:ag-a', null, { kind: 'chat', content: { text: 'halfway there' } });

    const groups = await h.api<Summary[]>('/api/agent-groups');
    expect(groups.find((g) => g.id === 'ag-a')!.activity).toEqual({ working: true, tool: null });
  });

  it('drops the mark when the reply arrives', async () => {
    const events = await h.openEvents();
    await h.adapter.setTyping!('web:ag-a', null);

    await h.adapter.deliver('web:ag-a', null, { kind: 'chat', content: { text: 'done' } });

    const activities = await events.ofType('activity', 2);
    expect(activities[1]).toEqual({
      type: 'activity',
      chatId: 'ag:ag-a',
      agentGroupId: 'ag-a',
      activity: { working: false, tool: null },
    });
    events.close();
  });
});

describe('ActivityBoard', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('goes idle once setTyping stops arriving', () => {
    vi.useFakeTimers();
    const changes: unknown[] = [];
    const board = new ActivityBoard((chatId, id, activity) => changes.push([chatId, id, activity]));

    board.touch('ag:ag-a', 'ag-a', null);
    vi.advanceTimersByTime(4000);
    board.touch('ag:ag-a', 'ag-a', 'Bash');
    vi.advanceTimersByTime(8000);
    expect(board.get('ag:ag-a', 'ag-a')).toEqual({ working: true, tool: 'Bash' });
    vi.advanceTimersByTime(2000);

    expect(board.get('ag:ag-a', 'ag-a')).toEqual({ working: false, tool: null });
    expect(changes).toEqual([
      ['ag:ag-a', 'ag-a', { working: true, tool: null }],
      ['ag:ag-a', 'ag-a', { working: true, tool: 'Bash' }],
      ['ag:ag-a', 'ag-a', { working: false, tool: null }],
    ]);
  });

  it('stays working while the Host holds back setTyping after a delivery', () => {
    vi.useFakeTimers();
    const board = new ActivityBoard(() => {});
    board.touch('ag:ag-a', 'ag-a', 'Bash');

    board.holdThroughDelivery('ag:ag-a', 'ag-a');
    vi.advanceTimersByTime(14_000);
    expect(board.get('ag:ag-a', 'ag-a')).toEqual({ working: true, tool: 'Bash' });
    board.touch('ag:ag-a', 'ag-a', 'Bash');
    vi.advanceTimersByTime(8000);
    expect(board.get('ag:ag-a', 'ag-a')).toEqual({ working: true, tool: 'Bash' });
    vi.advanceTimersByTime(2000);

    expect(board.get('ag:ag-a', 'ag-a')).toEqual({ working: false, tool: null });
  });

  it('does not start a mark when it holds an idle Agent Group', () => {
    vi.useFakeTimers();
    const board = new ActivityBoard(() => {});

    board.holdThroughDelivery('ag:ag-a', 'ag-a');

    expect(board.get('ag:ag-a', 'ag-a')).toEqual({ working: false, tool: null });
  });
});
