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

/** The Console Chat's Session, with the Agent in the middle of running `tool`. */
async function runningTool(agentGroupId: string, tool: string): Promise<void> {
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
  const outbound = new Database(outboundDbPath(agentGroupId, sessionId));
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

    expect(await events.next(1)).toEqual([
      { type: 'activity', agentGroupId: 'ag-a', activity: { working: true, tool: null } },
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

    expect(await events.next(1)).toEqual([
      { type: 'activity', agentGroupId: 'ag-a', activity: { working: true, tool: 'WebSearch' } },
    ]);
    events.close();
  });

  it('drops the mark when the reply arrives', async () => {
    const events = await h.openEvents();
    await h.adapter.setTyping!('web:ag-a', null);

    await h.adapter.deliver('web:ag-a', null, { kind: 'chat', content: { text: 'done' } });

    const activities = (await events.next(3)).filter((e) => (e as { type: string }).type === 'activity');
    expect(activities.at(-1)).toEqual({
      type: 'activity',
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
    const board = new ActivityBoard((id, activity) => changes.push([id, activity]), 9000);

    board.touch('ag-a', null);
    vi.advanceTimersByTime(4000);
    board.touch('ag-a', 'Bash');
    vi.advanceTimersByTime(8000);
    expect(board.get('ag-a')).toEqual({ working: true, tool: 'Bash' });
    vi.advanceTimersByTime(2000);

    expect(board.get('ag-a')).toEqual({ working: false, tool: null });
    expect(changes).toEqual([
      ['ag-a', { working: true, tool: null }],
      ['ag-a', { working: true, tool: 'Bash' }],
      ['ag-a', { working: false, tool: null }],
    ]);
  });
});
