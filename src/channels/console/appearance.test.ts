import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ENV = vi.hoisted(() => ({}) as Record<string, string>);

vi.mock('../../env.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../env.js')>()),
  readEnvFile: (keys: string[]) => Object.fromEntries(keys.filter((k) => k in ENV).map((k) => [k, ENV[k]])),
}));

import { createMessagingGroup, createMessagingGroupAgent } from '../../db/messaging-groups.js';
import { type Harness, startConsole, stopConsole } from './test-harness.js';

interface Summary {
  id: string;
  label: string | null;
  avatarUrl: string | null;
}

let h: Harness;

beforeEach(async () => {
  h = await startConsole();
});

afterEach(async () => {
  await stopConsole();
  vi.restoreAllMocks();
  for (const key of Object.keys(ENV)) delete ENV[key];
});

async function summaryOf(agentGroupId: string): Promise<Summary> {
  const groups = await h.api<Summary[]>('/api/agent-groups');
  return groups.find((g) => g.id === agentGroupId)!;
}

function send(pathname: string, body: unknown, method = 'POST'): Promise<Response> {
  return fetch(h.adapter.url() + pathname, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('label', () => {
  it('is set from the Panel, listed with the Agent Group, and survives a restart', async () => {
    expect((await summaryOf('ag-a')).label).toBeNull();

    const res = await send('/api/agent-groups/ag-a/label', { label: '  経理の下ごしらえ  ' });
    expect(res.status).toBe(200);
    await h.restart();

    expect((await summaryOf('ag-a')).label).toBe('経理の下ごしらえ');
    expect((await h.api<Summary>('/api/agent-groups/ag-a')).label).toBe('経理の下ごしらえ');
    expect((await summaryOf('ag-b')).label).toBeNull();
  });

  it('is removed by an empty label', async () => {
    await send('/api/agent-groups/ag-a/label', { label: '経理' });
    await send('/api/agent-groups/ag-a/label', { label: '   ' });
    expect((await summaryOf('ag-a')).label).toBeNull();
  });

  it('rejects a line break, even at the edge', async () => {
    expect((await send('/api/agent-groups/ag-a/label', { label: '経理\n' })).status).toBe(400);
    expect((await summaryOf('ag-a')).label).toBeNull();
  });

  it('accepts 40 characters and rejects 41', async () => {
    expect((await send('/api/agent-groups/ag-a/label', { label: 'あ'.repeat(40) })).status).toBe(200);
    const res = await send('/api/agent-groups/ag-a/label', { label: 'あ'.repeat(41) });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/40/);
    expect((await summaryOf('ag-a')).label).toBe('あ'.repeat(40));
  });

  it('tells open Consoles that the Agent Groups changed', async () => {
    const events = await h.openEvents();
    await events.next(0);
    await send('/api/agent-groups/ag-a/label', { label: '経理' });
    expect(await events.ofType('agent-groups', 1)).toEqual([{ type: 'agent-groups' }]);
    events.close();
  });

  it('is refused for an unknown Agent Group', async () => {
    expect((await send('/api/agent-groups/ag-x/label', { label: '経理' })).status).toBe(404);
  });
});

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('png-body')]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('jpeg-body')]);

function upload(agentGroupId: string, data: Buffer, mimeType = 'image/png'): Promise<Response> {
  return send(`/api/agent-groups/${agentGroupId}/avatar`, { mimeType, data: data.toString('base64') });
}

async function avatarOf(agentGroupId: string): Promise<{ type: string | null; body: Buffer } | null> {
  const { avatarUrl } = await summaryOf(agentGroupId);
  if (!avatarUrl) return null;
  const res = await fetch(h.adapter.url() + avatarUrl);
  expect(res.status).toBe(200);
  return { type: res.headers.get('content-type'), body: Buffer.from(await res.arrayBuffer()) };
}

describe('uploaded avatar', () => {
  it('is served as the uploaded image with its own type, sandboxed', async () => {
    expect((await summaryOf('ag-a')).avatarUrl).toBeNull();
    expect((await upload('ag-a', PNG)).status).toBe(200);

    const { avatarUrl } = await summaryOf('ag-a');
    const res = await fetch(h.adapter.url() + avatarUrl!);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toBe('sandbox');
    expect(Buffer.from(await res.arrayBuffer())).toEqual(PNG);
    expect((await h.api<Summary>('/api/agent-groups/ag-a')).avatarUrl).toBe(avatarUrl);
    expect((await summaryOf('ag-b')).avatarUrl).toBeNull();
  });

  it('takes its type from the bytes, not from what the browser claimed', async () => {
    await upload('ag-a', JPEG, 'image/png');
    expect((await avatarOf('ag-a'))?.type).toBe('image/jpeg');
  });

  it('gets a new URL when replaced, so browsers do not keep the old image', async () => {
    await upload('ag-a', PNG);
    const first = (await summaryOf('ag-a')).avatarUrl;
    await upload('ag-a', JPEG);
    expect((await summaryOf('ag-a')).avatarUrl).not.toBe(first);
    expect((await avatarOf('ag-a'))?.body).toEqual(JPEG);
  });

  it('rejects an image over 1 MB and a file that is not an image, saying why', async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(1024 * 1024)]);
    const tooBig = await upload('ag-a', big);
    expect(tooBig.status).toBe(413);
    expect(((await tooBig.json()) as { error: string }).error).toMatch(/1 MB/);

    const text = await upload('ag-a', Buffer.from('just text'), 'image/png');
    expect(text.status).toBe(400);
    expect(((await text.json()) as { error: string }).error).toMatch(/PNG, JPEG, WebP, GIF/);

    expect((await summaryOf('ag-a')).avatarUrl).toBeNull();
  });

  it('is removed with 画像を外す, falling back to the initial', async () => {
    await upload('ag-a', PNG);
    expect((await send('/api/agent-groups/ag-a/avatar', {}, 'DELETE')).status).toBe(200);
    expect((await summaryOf('ag-a')).avatarUrl).toBeNull();
    expect((await fetch(h.adapter.url() + '/api/agent-groups/ag-a/avatar')).status).toBe(404);
  });

  it('tells open Consoles that the Agent Groups changed', async () => {
    const events = await h.openEvents();
    await events.next(0);
    await upload('ag-a', PNG);
    await send('/api/agent-groups/ag-a/avatar', {}, 'DELETE');
    expect(await events.ofType('agent-groups', 2)).toHaveLength(2);
    events.close();
  });
});

const BOT_PNG = Buffer.concat([PNG, Buffer.from('bot')]);
const NEW_BOT_PNG = Buffer.concat([PNG, Buffer.from('new bot')]);

interface SlackCall {
  method: string;
  token: string | null;
  params: Record<string, string>;
}

/** Answers Slack's Web API and its image host; every other request reaches the real network stack. */
function fakeSlack(answer: (call: SlackCall) => unknown | Promise<unknown>, images: Record<string, Buffer>) {
  const calls: SlackCall[] = [];
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    const api = /^https:\/\/slack\.com\/api\/(.+)$/.exec(url);
    if (api) {
      const headers = new Headers(init?.headers);
      const call: SlackCall = {
        method: api[1],
        token: headers.get('authorization'),
        params: Object.fromEntries(new URLSearchParams(String(init?.body ?? ''))),
      };
      calls.push(call);
      return Response.json(await answer(call));
    }
    if (url in images) return new Response(images[url], { headers: { 'content-type': 'image/png' } });
    return realFetch(input, init);
  });
  return calls;
}

function botProfile(image: string) {
  return (call: SlackCall) =>
    call.method === 'auth.test'
      ? { ok: true, user_id: 'UBOT' }
      : { ok: true, user: { id: call.params.user, profile: { image_512: image } } };
}

async function wireSlack(agentGroupId: string, instance: string, createdAt: string): Promise<void> {
  const id = `mg-${instance}-${agentGroupId}`;
  await createMessagingGroup({
    id,
    channel_type: 'slack',
    platform_id: `slack:D-${instance}-${agentGroupId}`,
    instance,
    name: null,
    is_group: 0,
    unknown_sender_policy: 'strict',
    created_at: createdAt,
  });
  await createMessagingGroupAgent({
    id: `mga-${instance}-${agentGroupId}`,
    messaging_group_id: id,
    agent_group_id: agentGroupId,
    engage_mode: 'pattern',
    engage_pattern: '.',
    sender_scope: 'all',
    ignored_message_policy: 'drop',
    session_mode: 'shared',
    priority: 0,
    created_at: createdAt,
  });
}

async function listUntilAvatar(agentGroupId: string): Promise<string> {
  const events = await h.openEvents();
  await events.next(0);
  await h.api('/api/agent-groups');
  await events.ofType('agent-groups', 1);
  events.close();
  return (await summaryOf(agentGroupId)).avatarUrl!;
}

describe('Slack avatar', () => {
  it("shows the image of the Agent Group's own Slack bot, fetched once", async () => {
    ENV.SLACK_BOT_TOKEN_ALPHA = 'xoxb-alpha';
    await wireSlack('ag-a', 'slack-alpha', '2026-10-03T00:00:00.000Z');
    const calls = fakeSlack(botProfile('https://avatars.slack-edge.com/bot.png'), {
      'https://avatars.slack-edge.com/bot.png': BOT_PNG,
    });

    expect(await listUntilAvatar('ag-a')).not.toBeNull();
    expect((await avatarOf('ag-a'))?.body).toEqual(BOT_PNG);
    expect(calls.map((c) => [c.method, c.token])).toEqual([
      ['auth.test', 'Bearer xoxb-alpha'],
      ['users.info', 'Bearer xoxb-alpha'],
    ]);
    expect(calls[1].params).toEqual({ user: 'UBOT' });

    await h.api('/api/agent-groups');
    await h.restart();
    await h.api('/api/agent-groups');
    expect(calls).toHaveLength(2);
    expect((await avatarOf('ag-a'))?.body).toEqual(BOT_PNG);
  });

  it('uses the bot of the oldest Wiring when the Agent Group has several', async () => {
    ENV.SLACK_BOT_TOKEN_ALPHA = 'xoxb-alpha';
    ENV.SLACK_BOT_TOKEN_BETA = 'xoxb-beta';
    await wireSlack('ag-a', 'slack-beta', '2026-10-05T00:00:00.000Z');
    await wireSlack('ag-a', 'slack-alpha', '2026-10-04T00:00:00.000Z');
    const calls = fakeSlack(botProfile('https://avatars.slack-edge.com/bot.png'), {
      'https://avatars.slack-edge.com/bot.png': BOT_PNG,
    });

    await listUntilAvatar('ag-a');
    expect(new Set(calls.map((c) => c.token))).toEqual(new Set(['Bearer xoxb-alpha']));
  });

  it('fetches once a Slack bot of its own is wired after the Agent Group was first listed', async () => {
    ENV.SLACK_BOT_TOKEN_ALPHA = 'xoxb-alpha';
    const calls = fakeSlack(botProfile('https://avatars.slack-edge.com/bot.png'), {
      'https://avatars.slack-edge.com/bot.png': BOT_PNG,
    });
    await h.api('/api/agent-groups');
    await wireSlack('ag-a', 'slack-alpha', '2026-10-03T00:00:00.000Z');

    expect(await listUntilAvatar('ag-a')).not.toBeNull();
    expect(calls).toHaveLength(2);
  });

  it('leaves the classic shared bot and Agent Groups without Slack on their initial', async () => {
    ENV.SLACK_BOT_TOKEN = 'xoxb-classic';
    await wireSlack('ag-a', 'slack', '2026-10-03T00:00:00.000Z');
    const calls = fakeSlack(botProfile('https://avatars.slack-edge.com/bot.png'), {});

    await h.api('/api/agent-groups');
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toEqual([]);
    expect((await summaryOf('ag-a')).avatarUrl).toBeNull();
    expect((await summaryOf('ag-b')).avatarUrl).toBeNull();
  });

  it('answers the list without waiting for Slack, and falls back to the initial when Slack fails', async () => {
    ENV.SLACK_BOT_TOKEN_ALPHA = 'xoxb-alpha';
    await wireSlack('ag-a', 'slack-alpha', '2026-10-03T00:00:00.000Z');
    let fail!: () => void;
    const failed = new Promise<void>((resolve) => (fail = resolve));
    const calls = fakeSlack(async () => {
      await failed;
      return { ok: false, error: 'invalid_auth' };
    }, {});

    expect((await summaryOf('ag-a')).avatarUrl).toBeNull();
    fail();
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 20));
    expect((await summaryOf('ag-a')).avatarUrl).toBeNull();
  });

  it('comes back when the uploaded image is removed', async () => {
    ENV.SLACK_BOT_TOKEN_ALPHA = 'xoxb-alpha';
    await wireSlack('ag-a', 'slack-alpha', '2026-10-03T00:00:00.000Z');
    fakeSlack(botProfile('https://avatars.slack-edge.com/bot.png'), {
      'https://avatars.slack-edge.com/bot.png': BOT_PNG,
    });
    await listUntilAvatar('ag-a');

    await upload('ag-a', JPEG);
    expect((await avatarOf('ag-a'))?.body).toEqual(JPEG);
    expect((await h.api<{ avatarSource: string }>('/api/agent-groups/ag-a')).avatarSource).toBe('upload');
    await send('/api/agent-groups/ag-a/avatar', {}, 'DELETE');
    expect((await avatarOf('ag-a'))?.body).toEqual(BOT_PNG);
    expect((await h.api<{ avatarSource: string }>('/api/agent-groups/ag-a')).avatarSource).toBe('slack');
  });

  it('is replaced by Slack から取り直す', async () => {
    ENV.SLACK_BOT_TOKEN_ALPHA = 'xoxb-alpha';
    await wireSlack('ag-a', 'slack-alpha', '2026-10-03T00:00:00.000Z');
    let image = 'https://avatars.slack-edge.com/bot.png';
    fakeSlack((call) => botProfile(image)(call), {
      'https://avatars.slack-edge.com/bot.png': BOT_PNG,
      'https://avatars.slack-edge.com/new-bot.png': NEW_BOT_PNG,
    });
    await listUntilAvatar('ag-a');
    expect((await h.api<{ ownSlackBot: boolean }>('/api/agent-groups/ag-a')).ownSlackBot).toBe(true);

    image = 'https://avatars.slack-edge.com/new-bot.png';
    expect((await send('/api/agent-groups/ag-a/avatar/slack', {})).status).toBe(200);
    expect((await avatarOf('ag-a'))?.body).toEqual(NEW_BOT_PNG);
  });

  it('says why Slack から取り直す could not refetch', async () => {
    expect((await h.api<{ ownSlackBot: boolean }>('/api/agent-groups/ag-b')).ownSlackBot).toBe(false);
    const none = await send('/api/agent-groups/ag-b/avatar/slack', {});
    expect(none.status).toBe(409);

    ENV.SLACK_BOT_TOKEN_ALPHA = 'xoxb-alpha';
    await wireSlack('ag-a', 'slack-alpha', '2026-10-03T00:00:00.000Z');
    fakeSlack(() => ({ ok: false, error: 'invalid_auth' }), {});
    const failed = await send('/api/agent-groups/ag-a/avatar/slack', {});
    expect(failed.status).toBe(502);
    expect(((await failed.json()) as { error: string }).error).toMatch(/invalid_auth/);
  });
});
