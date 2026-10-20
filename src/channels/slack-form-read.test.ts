import { afterEach, describe, expect, it, vi } from 'vitest';

import { slackCall, slackConversationsInfo, slackConversationsMembers } from './slack-form-read.js';
import { SlackApiError } from './slack-lib.js';

const TOKEN = 'xoxb-secret-test-token-value';

function mockFetch(...responses: Record<string, unknown>[]) {
  const queue = responses.length > 0 ? responses : [{ ok: true }];
  const fn = vi.fn(
    async (..._args: unknown[]) => new Response(JSON.stringify(queue.shift() ?? queue.at(-1)), { status: 200 }),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

function sentRequest(fetchMock: ReturnType<typeof mockFetch>, call = 0) {
  const [url, init] = fetchMock.mock.calls[call] as [string, RequestInit];
  const headers = init.headers as Record<string, string>;
  return { url, contentType: headers['Content-Type'], authorization: headers.Authorization, body: init.body };
}

function formOf(body: unknown): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(String(body)));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Slack read methods', () => {
  it('sends conversations.members as a form so Slack reads the channel argument', async () => {
    const fetchMock = mockFetch({ ok: true, members: ['U1'] });

    await expect(slackConversationsMembers(TOKEN, 'C0ROOM', 'room-resolve')).resolves.toEqual(['U1']);

    const sent = sentRequest(fetchMock);
    expect(sent.url).toBe('https://slack.com/api/conversations.members');
    expect(sent.authorization).toBe(`Bearer ${TOKEN}`);
    expect(sent.contentType).toBe('application/x-www-form-urlencoded');
    expect(formOf(sent.body)).toEqual({ channel: 'C0ROOM', limit: '200' });
  });

  it('follows the conversations.members cursor across pages', async () => {
    const fetchMock = mockFetch(
      { ok: true, members: ['U1'], response_metadata: { next_cursor: 'next' } },
      { ok: true, members: ['U2'], response_metadata: { next_cursor: '' } },
    );

    await expect(slackConversationsMembers(TOKEN, 'C0ROOM', 'room-resolve')).resolves.toEqual(['U1', 'U2']);
    expect(formOf(sentRequest(fetchMock, 1).body)).toEqual({ channel: 'C0ROOM', limit: '200', cursor: 'next' });
  });

  it('sends conversations.info as a form and reads the channel classification', async () => {
    const fetchMock = mockFetch({ ok: true, channel: { is_mpim: true, name: 'mpdm-room', creator: 'U0OP' } });

    await expect(slackConversationsInfo(TOKEN, 'C0ROOM', 'room-lookup')).resolves.toEqual({
      isMpim: true,
      name: 'mpdm-room',
      creator: 'U0OP',
    });
    expect(formOf(sentRequest(fetchMock).body)).toEqual({ channel: 'C0ROOM' });
  });

  it('sends users.info through slackCall as a form', async () => {
    const fetchMock = mockFetch({ ok: true, user: { team_id: 'T1' } });

    await expect(slackCall(TOKEN, 'users.info', { user: 'U9' }, 'membership')).resolves.toMatchObject({
      user: { team_id: 'T1' },
    });
    expect(formOf(sentRequest(fetchMock).body)).toEqual({ user: 'U9' });
  });

  it('reports a Slack error with the caller step and without the token', async () => {
    mockFetch({ ok: false, error: 'channel_not_found' });

    const err = await slackConversationsInfo(TOKEN, 'C0GONE', 'room-lookup').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(SlackApiError);
    expect(err).toMatchObject({ step: 'room-lookup', message: 'slack conversations.info failed: channel_not_found' });
    expect(String((err as Error).message)).not.toContain(TOKEN);
  });
});

describe('other Slack methods', () => {
  it('keep a JSON body so nested arguments survive', async () => {
    const fetchMock = mockFetch({ ok: true });

    await slackCall(TOKEN, 'canvases.sections.lookup', { canvas_id: 'F1', criteria: { contains_text: 'x' } }, 's');

    const sent = sentRequest(fetchMock);
    expect(sent.contentType).toContain('application/json');
    expect(JSON.parse(String(sent.body))).toEqual({ canvas_id: 'F1', criteria: { contains_text: 'x' } });
  });
});
