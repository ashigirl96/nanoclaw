import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ChannelSetup, InboundMessage } from '../adapter.js';
import { closeDb, initTestDb, runMigrations } from '../../db/index.js';
import { createAgentGroup } from '../../db/agent-groups.js';
import {
  createMessagingGroup,
  createMessagingGroupAgent,
  getMessagingGroupAgents,
  getMessagingGroupsByAgentGroup,
} from '../../db/messaging-groups.js';
import { isOwner } from '../../modules/permissions/db/user-roles.js';
import { consoleAdapterFromEnv, createConsoleAdapter, type ConsoleAdapter } from './adapter.js';

interface Inbound {
  platformId: string;
  threadId: string | null;
  message: InboundMessage;
}

let tmp: string;
let distDir: string;
let adapter: ConsoleAdapter | null = null;
let inbound: Inbound[];

function setupRecorder(): ChannelSetup {
  return {
    onInbound: (platformId, threadId, message) => {
      inbound.push({ platformId, threadId, message });
    },
    onInboundEvent: () => {},
    onMetadata: () => {},
    onAction: () => {},
  };
}

async function start(): Promise<ConsoleAdapter> {
  adapter = createConsoleAdapter({ port: 0, dataDir: tmp, distDir });
  await adapter.setup(setupRecorder());
  return adapter;
}

async function stop(): Promise<void> {
  await adapter?.teardown();
  adapter = null;
}

async function api<T = unknown>(pathname: string, init?: RequestInit): Promise<T> {
  const res = await fetch(adapter!.url() + pathname, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  if (!res.ok) throw new Error(`${pathname} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'console-test-'));
  distDir = path.join(tmp, 'dist');
  inbound = [];
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
  await stop();
  await closeDb();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('sidebar', () => {
  it('lists every Agent Group, with no excerpt before any message', async () => {
    await start();

    const groups = await api<Array<{ id: string; name: string; lastMessage: unknown }>>('/api/agent-groups');

    expect(groups.map((g) => [g.id, g.name, g.lastMessage])).toEqual([
      ['ag-a', 'Alice', null],
      ['ag-b', 'Bob', null],
    ]);
  });
});

describe('opening a Chat', () => {
  async function wiringsOf(agentGroupId: string) {
    const rows = [];
    for (const mg of await getMessagingGroupsByAgentGroup(agentGroupId)) {
      for (const w of await getMessagingGroupAgents(mg.id)) {
        if (w.agent_group_id !== agentGroupId) continue;
        rows.push({
          channel: mg.channel_type,
          platformId: mg.platform_id,
          policy: mg.unknown_sender_policy,
          engage: [w.engage_mode, w.engage_pattern],
          sessionMode: w.session_mode,
          wiringId: w.id,
        });
      }
    }
    return rows;
  }

  it('creates the Console Messaging Group and Wiring once, leaving Slack alone', async () => {
    await createMessagingGroup({
      id: 'mg-slack',
      channel_type: 'slack',
      platform_id: 'slack:C1',
      instance: 'slack',
      name: 'general',
      is_group: 1,
      unknown_sender_policy: 'request_approval',
      denied_at: null,
      created_at: '2026-10-01T00:00:00.000Z',
    });
    await createMessagingGroupAgent({
      id: 'mga-slack',
      messaging_group_id: 'mg-slack',
      agent_group_id: 'ag-a',
      engage_mode: 'mention',
      engage_pattern: null,
      sender_scope: 'all',
      ignored_message_policy: 'drop',
      session_mode: 'shared',
      priority: 0,
      created_at: '2026-10-01T00:00:00.000Z',
    });
    await start();
    const slackBefore = (await wiringsOf('ag-a')).filter((w) => w.channel === 'slack');

    await api('/api/agent-groups/ag-a/open', { method: 'POST' });
    await api('/api/agent-groups/ag-a/open', { method: 'POST' });

    const after = await wiringsOf('ag-a');
    expect(after.filter((w) => w.channel === 'slack')).toEqual(slackBefore);
    const web = after.filter((w) => w.channel === 'web');
    expect(web).toHaveLength(1);
    expect(web[0]).toMatchObject({
      platformId: 'web:ag-a',
      policy: 'strict',
      engage: ['pattern', '.'],
      sessionMode: 'shared',
    });
  });

  it('makes web:owner an Owner so the strict policy admits the Console', async () => {
    await start();

    await api('/api/agent-groups/ag-a/open', { method: 'POST' });

    expect(await isOwner('web:owner')).toBe(true);
  });
});

interface ChatMessage {
  id: string;
  role: 'owner' | 'agent';
  text: string;
  reactions: string[];
  files: Array<{ id: string; name: string; mimeType: string }>;
}

async function send(agentGroupId: string, body: Record<string, unknown>): Promise<ChatMessage> {
  return api<ChatMessage>(`/api/agent-groups/${agentGroupId}/messages`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

async function history(agentGroupId: string): Promise<ChatMessage[]> {
  return api<ChatMessage[]>(`/api/agent-groups/${agentGroupId}/messages`);
}

describe('sending text', () => {
  it('reaches the Agent as a Chat Message from web:owner', async () => {
    await start();

    await send('ag-a', { text: 'hello' });

    expect(inbound).toHaveLength(1);
    expect(inbound[0].platformId).toBe('web:ag-a');
    expect(inbound[0].threadId).toBeNull();
    expect(inbound[0].message).toMatchObject({
      kind: 'chat',
      content: { text: 'hello', senderId: 'web:owner' },
    });
  });

  it('shows in the history and as the sidebar excerpt', async () => {
    await start();

    await send('ag-a', { text: 'hello' });

    expect((await history('ag-a')).map((m) => [m.role, m.text])).toEqual([['owner', 'hello']]);
    const groups = await api<Array<{ id: string; lastMessage: { text: string } | null }>>('/api/agent-groups');
    expect(groups.find((g) => g.id === 'ag-a')?.lastMessage?.text).toBe('hello');
    expect(groups.find((g) => g.id === 'ag-b')?.lastMessage).toBeNull();
  });
});

describe('delivering Outbound Messages', () => {
  it('shows the reply in the Chat and returns its message id', async () => {
    const consoleAdapter = await start();

    const id = await consoleAdapter.deliver('web:ag-a', null, { kind: 'chat', content: { text: 'hi there' } });

    const messages = await history('ag-a');
    expect(messages.map((m) => [m.role, m.text])).toEqual([['agent', 'hi there']]);
    expect(id).toBe(messages[0].id);
  });

  it('applies edit and reaction to the message the id points at', async () => {
    const consoleAdapter = await start();
    const id = await consoleAdapter.deliver('web:ag-a', null, { kind: 'chat', content: { text: 'draft' } });

    const editResult = await consoleAdapter.deliver('web:ag-a', null, {
      kind: 'chat',
      content: { operation: 'edit', messageId: id, text: 'final' },
    });
    await consoleAdapter.deliver('web:ag-a', null, {
      kind: 'chat',
      content: { operation: 'reaction', messageId: id, emoji: 'thumbs_up' },
    });

    expect(editResult).toBeUndefined();
    expect((await history('ag-a')).map((m) => [m.text, m.reactions])).toEqual([['final', ['thumbs_up']]]);
  });

  it('applies a reaction to an Owner message, addressed by the id the router gave the Agent', async () => {
    const consoleAdapter = await start();
    const sent = await send('ag-a', { text: 'hello' });

    await consoleAdapter.deliver('web:ag-a', null, {
      kind: 'chat',
      content: { operation: 'reaction', messageId: `${sent.id}:ag-a`, emoji: 'eyes' },
    });

    expect((await history('ag-a'))[0].reactions).toEqual(['eyes']);
  });

  it('ignores edits aimed at another Chat', async () => {
    const consoleAdapter = await start();
    const id = await consoleAdapter.deliver('web:ag-a', null, { kind: 'chat', content: { text: 'mine' } });

    await consoleAdapter.deliver('web:ag-b', null, {
      kind: 'chat',
      content: { operation: 'edit', messageId: id, text: 'hijacked' },
    });

    expect((await history('ag-a'))[0].text).toBe('mine');
  });

  it('pushes new and updated messages over SSE', async () => {
    const consoleAdapter = await start();
    const events = await openEvents();

    const id = await consoleAdapter.deliver('web:ag-a', null, { kind: 'chat', content: { text: 'one' } });
    await consoleAdapter.deliver('web:ag-a', null, {
      kind: 'chat',
      content: { operation: 'edit', messageId: id, text: 'two' },
    });

    const messages = (await events.next(3)).filter((e) => (e as { type: string }).type === 'message');
    expect(messages).toEqual([
      expect.objectContaining({ type: 'message', message: expect.objectContaining({ id, text: 'one' }) }),
      expect.objectContaining({ type: 'message', message: expect.objectContaining({ id, text: 'two' }) }),
    ]);
    events.close();
  });

  it('keeps sent and received text across a Host restart', async () => {
    const first = await start();
    await send('ag-a', { text: 'question' });
    await first.deliver('web:ag-a', null, { kind: 'chat', content: { text: 'answer' } });
    await stop();

    await start();

    expect((await history('ag-a')).map((m) => [m.role, m.text])).toEqual([
      ['owner', 'question'],
      ['agent', 'answer'],
    ]);
  });
});

describe('files', () => {
  it('serves files from send_file with a content type the browser can preview', async () => {
    const consoleAdapter = await start();

    await consoleAdapter.deliver('web:ag-a', null, {
      kind: 'chat',
      content: { text: 'here', files: ['chart.png', 'report.pdf', 'notes.md'] },
      files: [
        { filename: 'chart.png', data: Buffer.from('png-bytes') },
        { filename: 'report.pdf', data: Buffer.from('pdf-bytes') },
        { filename: 'notes.md', data: Buffer.from('# notes') },
      ],
    });

    const [message] = await history('ag-a');
    expect(message.files.map((f) => [f.name, f.mimeType])).toEqual([
      ['chart.png', 'image/png'],
      ['report.pdf', 'application/pdf'],
      ['notes.md', 'text/markdown; charset=utf-8'],
    ]);
    const res = await fetch(`${adapter!.url()}/api/files/${message.files[0].id}`);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('png-bytes');
  });

  it('forwards files attached in the Console to the Agent and keeps them in the history', async () => {
    await start();

    await send('ag-a', {
      text: 'look',
      files: [{ name: 'photo.jpg', mimeType: 'image/jpeg', data: Buffer.from('jpg-bytes').toString('base64') }],
    });

    expect(inbound[0].message.content).toMatchObject({
      text: 'look',
      attachments: [
        { type: 'image', name: 'photo.jpg', mimeType: 'image/jpeg', data: Buffer.from('jpg-bytes').toString('base64') },
      ],
    });
    expect((await history('ag-a'))[0].files.map((f) => f.name)).toEqual(['photo.jpg']);
  });

  it('accepts a message that is only an attachment', async () => {
    await start();

    await send('ag-a', { files: [{ name: 'a.txt', mimeType: 'text/plain', data: 'aGk=' }] });

    expect(inbound).toHaveLength(1);
  });
});

describe('the page', () => {
  it('returns build instructions while web/dist is missing', async () => {
    await start();

    const res = await fetch(adapter!.url() + '/');

    expect(res.status).toBe(503);
    expect(await res.text()).toContain('pnpm --dir web run build');
  });

  it('serves web/dist, falling back to index.html for client routes', async () => {
    fs.mkdirSync(path.join(distDir, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(distDir, 'index.html'), '<div id="root"></div>');
    fs.writeFileSync(path.join(distDir, 'assets', 'app.js'), 'console.log(1)');
    await start();

    const asset = await fetch(adapter!.url() + '/assets/app.js');
    const route = await fetch(adapter!.url() + '/chat/ag-a');
    const escape = await fetch(adapter!.url() + '/..%2f..%2fpackage.json');

    expect(asset.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(await asset.text()).toBe('console.log(1)');
    expect(await route.text()).toBe('<div id="root"></div>');
    expect(await escape.text()).toBe('<div id="root"></div>');
  });
});

describe('starting from the environment', () => {
  it('does not start without CONSOLE_PORT', () => {
    expect(consoleAdapterFromEnv({})).toBeNull();
  });

  it('listens on CONSOLE_PORT', () => {
    expect(consoleAdapterFromEnv({ CONSOLE_PORT: '4317' })).toMatchObject({ channelType: 'web' });
  });
});

describe('requests from other sites', () => {
  function rawRequest(opts: { method: string; path: string; headers: Record<string, string>; body?: string }) {
    const { port } = new URL(adapter!.url());
    return new Promise<number>((resolve, reject) => {
      const req = http.request({
        host: '127.0.0.1',
        port,
        method: opts.method,
        path: opts.path,
        headers: opts.headers,
      });
      req.on('response', (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on('error', reject);
      req.end(opts.body);
    });
  }

  it('rejects a POST that a cross-site form could send without a preflight', async () => {
    await start();

    const status = await rawRequest({
      method: 'POST',
      path: '/api/agent-groups/ag-a/messages',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ text: 'forged' }),
    });

    expect(status).toBe(415);
    expect(inbound).toHaveLength(0);
  });

  it('rejects a request whose Host is not local (DNS rebinding)', async () => {
    await start();

    const status = await rawRequest({ method: 'GET', path: '/api/agent-groups', headers: { host: 'evil.example:80' } });

    expect(status).toBe(403);
  });

  it('serves Agent files in a sandbox so their scripts cannot call the API', async () => {
    const consoleAdapter = await start();
    await consoleAdapter.deliver('web:ag-a', null, {
      kind: 'chat',
      content: { text: '' },
      files: [{ filename: 'x.svg', data: Buffer.from('<svg/>') }],
    });
    const [message] = await history('ag-a');

    const res = await fetch(`${adapter!.url()}/api/files/${message.files[0].id}`);

    expect(res.headers.get('content-security-policy')).toBe('sandbox');
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
