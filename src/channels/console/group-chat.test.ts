import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getDb } from '../../db/connection.js';
import { closeDb, initTestDb, runMigrations } from '../../db/index.js';
import { createAgentGroup } from '../../db/agent-groups.js';
import { getMessagingGroupAgents, getMessagingGroupByPlatform } from '../../db/messaging-groups.js';
import { findSessionForAgent } from '../../db/sessions.js';
import { wakeContainer } from '../../container-runner.js';
import { inboundDbPath } from '../../mailbox/sqlite/paths.js';
import '../../modules/permissions/index.js';
import { routeInbound } from '../../router.js';
import type { ChannelSetup } from '../adapter.js';
import { createConsoleAdapter, type ConsoleAdapter } from './adapter.js';
import { openEvents } from './test-harness.js';

vi.mock('../../container-runner.js', () => ({
  wakeContainer: vi.fn().mockResolvedValue(true),
  isContainerRunning: vi.fn().mockReturnValue(false),
  getActiveContainerCount: vi.fn().mockReturnValue(0),
  killContainer: vi.fn(),
}));

vi.mock('../../config.js', async () => {
  const actual = await vi.importActual('../../config.js');
  return { ...actual, DATA_DIR: '/tmp/nanoclaw-test-console-group-chat' };
});

const SESSIONS_DIR = '/tmp/nanoclaw-test-console-group-chat';

let tmp: string;
let adapter: ConsoleAdapter | null = null;

// The Host's own onInbound, so a Console message runs through the real router.
const routingSetup: ChannelSetup = {
  onInbound: (platformId, threadId, message) =>
    routeInbound({
      channelType: 'web',
      instance: 'web',
      platformId,
      threadId,
      message: {
        id: message.id,
        kind: message.kind,
        content: JSON.stringify(message.content),
        timestamp: message.timestamp,
        isMention: message.isMention,
        isGroup: message.isGroup,
      },
    }),
  onInboundEvent: () => {},
  onMetadata: () => {},
  onAction: () => {},
};

async function api<T = unknown>(pathname: string, init?: RequestInit): Promise<T> {
  const res = await fetch(adapter!.url() + pathname, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  if (!res.ok) throw new Error(`${pathname} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

function post<T = unknown>(pathname: string, body: unknown): Promise<T> {
  return api<T>(pathname, { method: 'POST', body: JSON.stringify(body) });
}

interface GroupChat {
  id: string;
  chatId: string;
  name: string;
  members: Array<{ id: string; name: string }>;
}

function createGroupChat(name: string, agentGroupIds: string[]): Promise<GroupChat> {
  return post<GroupChat>('/api/group-chats', { name, agentGroupIds });
}

function say(chat: GroupChat, text: string): Promise<{ id: string }> {
  return post(`/api/group-chats/${chat.id}/messages`, { text });
}

function woken(): string[] {
  return vi.mocked(wakeContainer).mock.calls.map(([session]) => session.agent_group_id);
}

async function sessionOf(agentGroupId: string, platformId: string) {
  const mg = await getMessagingGroupByPlatform('web', platformId);
  return mg ? findSessionForAgent(agentGroupId, mg.id, null) : undefined;
}

/** What the Agent's Session holds from this platform id, oldest first. */
async function sessionMessages(agentGroupId: string, platformId: string) {
  const session = await sessionOf(agentGroupId, platformId);
  if (!session) return [];
  const db = new Database(inboundDbPath(agentGroupId, session.id), { readonly: true });
  try {
    const rows = db.prepare('SELECT content, trigger FROM messages_in ORDER BY seq').all() as Array<{
      content: string;
      trigger: number;
    }>;
    return rows.map((r) => {
      const content = JSON.parse(r.content) as { text: string; sender: string };
      return { text: content.text, sender: content.sender, trigger: r.trigger };
    });
  } finally {
    db.close();
  }
}

// What `ncl groups delete` leaves behind for the Console: the Agent Group is gone, its Group Chat membership is not.
async function deleteAgentGroupRow(id: string): Promise<void> {
  const db = getDb();
  await db.run('DELETE FROM sessions WHERE agent_group_id = ?', id);
  await db.run('DELETE FROM agent_destinations WHERE agent_group_id = ? OR target_id = ?', id, id);
  await db.run('DELETE FROM messaging_group_agents WHERE agent_group_id = ?', id);
  await db.run('DELETE FROM agent_groups WHERE id = ?', id);
}

function platformIdOf(chat: GroupChat, agentGroupId: string): string {
  return `web:gc:${chat.id}:${agentGroupId}`;
}

beforeEach(async () => {
  vi.mocked(wakeContainer).mockClear();
  fs.rmSync(SESSIONS_DIR, { recursive: true, force: true });
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'console-group-chat-test-'));
  await runMigrations(await initTestDb());
  for (const [id, name, folder] of [
    ['ag-a', 'Alice', 'alice'],
    ['ag-b', 'Bob', 'bob'],
    ['ag-c', 'Carol', 'carol'],
  ]) {
    await createAgentGroup({ id, name, folder, agent_provider: null, created_at: '2026-10-01T00:00:00.000Z' });
  }
  adapter = createConsoleAdapter({ port: 0, dataDir: tmp, distDir: path.join(tmp, 'dist') });
  await adapter.setup(routingSetup);
});

afterEach(async () => {
  await adapter?.teardown();
  adapter = null;
  await closeDb();
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(SESSIONS_DIR, { recursive: true, force: true });
});

describe('Mention in a Group Chat', () => {
  it('wakes only the Agent the Owner names', async () => {
    const chat = await createGroupChat('相談', ['ag-a', 'ag-b']);

    await say(chat, '@Alice 調べてください');

    expect(woken()).toEqual(['ag-a']);
  });

  it('gives every participant the message before it wakes the named one', async () => {
    const chat = await createGroupChat('相談', ['ag-a', 'ag-b']);
    let othersAtWake: string[] = [];
    vi.mocked(wakeContainer).mockImplementationOnce(async () => {
      othersAtWake = (await sessionMessages('ag-b', platformIdOf(chat, 'ag-b'))).map((m) => m.text);
      return true;
    });

    await say(chat, '@Alice 調べて');

    expect(woken()).toEqual(['ag-a']);
    expect(othersAtWake).toEqual(['@Alice 調べて']);
  });

  it('wakes no one without a Mention, and the next Mention finds that message as context', async () => {
    const chat = await createGroupChat('相談', ['ag-a', 'ag-b']);

    await say(chat, '明日は雨らしい');
    expect(woken()).toEqual([]);
    await say(chat, '@Alice 傘はいる？');

    expect(woken()).toEqual(['ag-a']);
    expect(await sessionMessages('ag-a', platformIdOf(chat, 'ag-a'))).toEqual([
      { text: '明日は雨らしい', sender: 'Owner', trigger: 0 },
      { text: '@Alice 傘はいる？', sender: 'Owner', trigger: 1 },
    ]);
    expect(await sessionMessages('ag-b', platformIdOf(chat, 'ag-b'))).toEqual([
      { text: '明日は雨らしい', sender: 'Owner', trigger: 0 },
      { text: '@Alice 傘はいる？', sender: 'Owner', trigger: 0 },
    ]);
  });

  it('names an Agent whose name another one starts with without waking that one', async () => {
    await createAgentGroup({
      id: 'ag-al',
      name: 'Al',
      folder: 'al',
      agent_provider: null,
      created_at: '2026-10-01T00:00:00.000Z',
    });
    const chat = await createGroupChat('相談', ['ag-a', 'ag-al']);

    await say(chat, '@alice どう思う？');

    expect(woken()).toEqual(['ag-a']);
  });

  it('does not take an email address or a longer word for a Mention', async () => {
    const chat = await createGroupChat('相談', ['ag-a', 'ag-b']);

    await say(chat, 'mail@bob.com と @Alicea に送った');

    expect(woken()).toEqual([]);
  });

  it('takes a name followed by Japanese text for a Mention', async () => {
    const chat = await createGroupChat('相談', ['ag-a', 'ag-b']);

    await say(chat, '@Bobさん、お願い');

    expect(woken()).toEqual(['ag-b']);
  });
});

describe('replies in a Group Chat', () => {
  it('drops a reply that arrives after its Agent was removed', async () => {
    const chat = await createGroupChat('相談', ['ag-a', 'ag-b', 'ag-c']);
    await api(`/api/group-chats/${chat.id}/members/ag-c`, { method: 'DELETE' });

    const id = await adapter!.deliver(platformIdOf(chat, 'ag-c'), null, {
      kind: 'chat',
      content: { text: '遅れて返事' },
    });

    expect(id).toBeUndefined();
    expect(await api<unknown[]>(`/api/group-chats/${chat.id}/messages`)).toEqual([]);
    expect(await sessionMessages('ag-a', platformIdOf(chat, 'ag-a'))).toEqual([]);
  });

  it("passes an Agent's edit on to the others' Sessions", async () => {
    const chat = await createGroupChat('相談', ['ag-a', 'ag-b']);
    const id = await adapter!.deliver(platformIdOf(chat, 'ag-a'), null, {
      kind: 'chat',
      content: { text: '答えは 3' },
    });

    await adapter!.deliver(platformIdOf(chat, 'ag-a'), null, {
      kind: 'chat',
      content: { operation: 'edit', messageId: id, text: '答えは 4' },
    });

    expect(
      (await sessionMessages('ag-b', platformIdOf(chat, 'ag-b'))).map((m) => [m.text, m.sender, m.trigger]),
    ).toEqual([
      ['答えは 3', 'Alice', 0],
      ['答えは 4', 'Alice', 0],
    ]);
  });

  it("shows the reply as the Agent's and puts it in the others' Sessions without waking them", async () => {
    const chat = await createGroupChat('相談', ['ag-a', 'ag-b']);
    await say(chat, '@Alice 調べて');
    vi.mocked(wakeContainer).mockClear();

    await adapter!.deliver(platformIdOf(chat, 'ag-a'), null, {
      kind: 'chat',
      content: { text: '調べました。@Bob 確認して' },
    });

    const history = await api<Array<{ role: string; agentGroupId: string | null; text: string }>>(
      `/api/group-chats/${chat.id}/messages`,
    );
    expect(history.map((m) => [m.role, m.agentGroupId, m.text])).toEqual([
      ['owner', null, '@Alice 調べて'],
      ['agent', 'ag-a', '調べました。@Bob 確認して'],
    ]);
    expect(woken()).toEqual([]);
    expect((await sessionMessages('ag-b', platformIdOf(chat, 'ag-b'))).at(-1)).toEqual({
      text: '調べました。@Bob 確認して',
      sender: 'Alice',
      trigger: 0,
    });
  });
});

describe('participants', () => {
  it('refuses two participants that share a name, since a Mention could not tell them apart', async () => {
    await createAgentGroup({
      id: 'ag-a2',
      name: 'alice',
      folder: 'alice2',
      agent_provider: null,
      created_at: '2026-10-01T00:00:00.000Z',
    });
    const chat = await createGroupChat('相談', ['ag-a', 'ag-b']);

    const created = await fetch(`${adapter!.url()}/api/group-chats`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '同名', agentGroupIds: ['ag-a', 'ag-a2'] }),
    });
    const added = await fetch(`${adapter!.url()}/api/group-chats/${chat.id}/members`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentGroupId: 'ag-a2' }),
    });

    expect([created.status, added.status]).toEqual([409, 409]);
    expect((await api<GroupChat[]>('/api/group-chats')).map((c) => c.members.map((m) => m.id))).toEqual([
      ['ag-a', 'ag-b'],
    ]);
  });

  it('does not count a participant whose Agent Group was deleted', async () => {
    const chat = await createGroupChat('相談', ['ag-a', 'ag-b', 'ag-c']);
    await deleteAgentGroupRow('ag-c');

    const res = await fetch(`${adapter!.url()}/api/group-chats/${chat.id}/members/ag-b`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
    });

    expect(res.status).toBe(409);
  });

  it('lets an added Agent answer later Mentions without the earlier history', async () => {
    const chat = await createGroupChat('相談', ['ag-a', 'ag-b']);
    await say(chat, '前置き');

    await post(`/api/group-chats/${chat.id}/members`, { agentGroupId: 'ag-c' });
    await say(chat, '@Carol よろしく');

    expect(woken()).toEqual(['ag-c']);
    expect((await sessionMessages('ag-c', platformIdOf(chat, 'ag-c'))).map((m) => m.text)).toEqual(['@Carol よろしく']);
  });

  it('stops waking a removed Agent and keeps what its Session already holds', async () => {
    const chat = await createGroupChat('相談', ['ag-a', 'ag-b', 'ag-c']);
    await say(chat, '@Bob 最初の話');
    vi.mocked(wakeContainer).mockClear();

    const after = await api<GroupChat>(`/api/group-chats/${chat.id}/members/ag-b`, { method: 'DELETE' });
    await say(chat, '@Bob まだいる？');

    expect(after.members.map((m) => m.id)).toEqual(['ag-a', 'ag-c']);
    expect(woken()).toEqual([]);
    expect((await sessionMessages('ag-b', platformIdOf(chat, 'ag-b'))).map((m) => m.text)).toEqual(['@Bob 最初の話']);
    expect((await api<unknown[]>(`/api/group-chats/${chat.id}/messages`)).length).toBe(2);
  });

  it('keeps at least two participants', async () => {
    const chat = await createGroupChat('相談', ['ag-a', 'ag-b']);

    const res = await fetch(`${adapter!.url()}/api/group-chats/${chat.id}/members/ag-b`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
    });

    expect(res.status).toBe(409);
    expect((await api<GroupChat[]>('/api/group-chats'))[0].members.map((m) => m.id)).toEqual(['ag-a', 'ag-b']);
  });
});

describe('deleting a Group Chat', () => {
  it('removes its Wirings and Messaging Groups and drops it from the list', async () => {
    const chat = await createGroupChat('相談', ['ag-a', 'ag-b']);
    await say(chat, '@Alice @Bob 二人とも');
    await post(`/api/group-chats/${chat.id}/members`, { agentGroupId: 'ag-c' });
    await api(`/api/group-chats/${chat.id}/members/ag-c`, { method: 'DELETE' });

    await api(`/api/group-chats/${chat.id}`, { method: 'DELETE' });

    for (const id of ['ag-a', 'ag-b', 'ag-c']) {
      expect(await getMessagingGroupByPlatform('web', platformIdOf(chat, id))).toBeUndefined();
    }
    expect(await api<unknown[]>('/api/group-chats')).toEqual([]);
  });

  it("leaves the Agents' own Chats wired", async () => {
    await post('/api/agent-groups/ag-a/open', {});
    const chat = await createGroupChat('相談', ['ag-a', 'ag-b']);

    await api(`/api/group-chats/${chat.id}`, { method: 'DELETE' });

    const own = await getMessagingGroupByPlatform('web', 'web:ag-a');
    expect((await getMessagingGroupAgents(own!.id)).map((w) => w.agent_group_id)).toEqual(['ag-a']);
  });
});

describe('the sidebar', () => {
  interface Summary {
    id: string;
    chatId: string;
    unread: number;
    activity: Record<string, { working: boolean }>;
  }
  interface AgentGroupSummary {
    id: string;
    unread: number;
    activity: { working: boolean };
  }

  async function groupChatSummary(chat: GroupChat): Promise<Summary> {
    return (await api<Summary[]>('/api/group-chats')).find((c) => c.id === chat.id)!;
  }

  async function agentGroupSummary(id: string): Promise<AgentGroupSummary> {
    return (await api<AgentGroupSummary[]>('/api/agent-groups')).find((g) => g.id === id)!;
  }

  it("counts unread replies per Group Chat, apart from the Agent's own Chat", async () => {
    const chat = await createGroupChat('相談', ['ag-a', 'ag-b']);
    await adapter!.deliver(platformIdOf(chat, 'ag-a'), null, { kind: 'chat', content: { text: 'A です' } });
    const reply = await adapter!.deliver(platformIdOf(chat, 'ag-b'), null, {
      kind: 'chat',
      content: { text: 'B です' },
    });

    expect((await groupChatSummary(chat)).unread).toBe(2);
    expect((await agentGroupSummary('ag-a')).unread).toBe(0);

    await post(`/api/group-chats/${chat.id}/read`, { messageId: reply });
    expect((await groupChatSummary(chat)).unread).toBe(0);
  });

  it('marks only the Agent that is working, only in the Group Chat it works in', async () => {
    const chat = await createGroupChat('相談', ['ag-a', 'ag-b']);
    const events = await openEvents(adapter!.url());

    await adapter!.setTyping!(platformIdOf(chat, 'ag-a'), null);

    expect((await events.ofType('activity', 1))[0]).toEqual({
      type: 'activity',
      chatId: chat.chatId,
      agentGroupId: 'ag-a',
      activity: { working: true, tool: null },
    });
    expect((await groupChatSummary(chat)).activity).toEqual({
      'ag-a': { working: true, tool: null },
      'ag-b': { working: false, tool: null },
    });
    expect((await agentGroupSummary('ag-a')).activity.working).toBe(false);
    events.close();
  });
});

describe('Sessions', () => {
  it("keeps an Agent's Group Chat Session apart from its own Chat's", async () => {
    const chat = await createGroupChat('相談', ['ag-a', 'ag-b']);
    await post('/api/agent-groups/ag-a/open', {});
    await post('/api/agent-groups/ag-a/messages', { text: 'ひとりごと' });
    await say(chat, '@Alice みんなの前で');

    const own = await sessionOf('ag-a', 'web:ag-a');
    const inGroupChat = await sessionOf('ag-a', platformIdOf(chat, 'ag-a'));

    expect(own).toBeDefined();
    expect(inGroupChat).toBeDefined();
    expect(inGroupChat!.id).not.toBe(own!.id);
    expect((await sessionMessages('ag-a', 'web:ag-a')).map((m) => m.text)).toEqual(['ひとりごと']);
  });
});
