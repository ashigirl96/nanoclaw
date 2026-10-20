import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type Harness, startConsole, stopConsole } from './test-harness.js';

interface Summary {
  id: string;
  unread: number;
}

let h: Harness;

beforeEach(async () => {
  h = await startConsole();
});

afterEach(async () => {
  await stopConsole();
});

async function unreadOf(agentGroupId: string): Promise<number | undefined> {
  const groups = await h.api<Summary[]>('/api/agent-groups');
  return groups.find((g) => g.id === agentGroupId)?.unread;
}

async function reply(agentGroupId: string, text: string): Promise<string> {
  return (await h.adapter.deliver(`web:${agentGroupId}`, null, { kind: 'chat', content: { text } }))!;
}

async function markRead(agentGroupId: string, messageId: string) {
  return h.api<{ unread: number }>(`/api/agent-groups/${agentGroupId}/read`, {
    method: 'POST',
    body: JSON.stringify({ messageId }),
  });
}

describe('unread', () => {
  it('counts Agent replies the Owner has not read, per Agent Group', async () => {
    await h.api('/api/agent-groups/ag-a/messages', { method: 'POST', body: JSON.stringify({ text: 'hi' }) });
    await reply('ag-a', 'one');
    await reply('ag-a', 'two');

    expect(await unreadOf('ag-a')).toBe(2);
    expect(await unreadOf('ag-b')).toBe(0);
  });

  it('clears up to the message the Owner has seen, and keeps that across a Host restart', async () => {
    await reply('ag-a', 'one');
    const seen = await reply('ag-a', 'two');

    expect(await markRead('ag-a', seen)).toEqual({ unread: 0 });
    await h.restart();
    await reply('ag-a', 'three');

    expect(await unreadOf('ag-a')).toBe(1);
  });

  it('never moves the read position back to an older message', async () => {
    const first = await reply('ag-a', 'one');
    const second = await reply('ag-a', 'two');
    await markRead('ag-a', second);

    expect(await markRead('ag-a', first)).toEqual({ unread: 0 });
  });

  it('pushes the new count when a reply arrives and when the Owner reads it', async () => {
    const events = await h.openEvents();

    const id = await reply('ag-a', 'one');
    await markRead('ag-a', id);

    expect(await events.ofType('unread', 2)).toEqual([
      { type: 'unread', chatId: 'ag:ag-a', unread: 1 },
      { type: 'unread', chatId: 'ag:ag-a', unread: 0 },
    ]);
    events.close();
  });

  it('refuses a message id from another Chat', async () => {
    const other = await reply('ag-b', 'not yours');
    await reply('ag-a', 'one');

    await expect(markRead('ag-a', other)).rejects.toThrow('404');
    expect(await unreadOf('ag-a')).toBe(1);
  });
});
