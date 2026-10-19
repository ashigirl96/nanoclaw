import http from 'http';
import type { AddressInfo } from 'net';

import { afterEach, describe, expect, it } from 'vitest';

import { onecliEndpointFromEnv } from './connected-accounts.js';
import { type Harness, startConsole, stopConsole } from './test-harness.js';

interface FakeOnecli {
  url: string;
  close(): Promise<void>;
}

const APPS = [
  {
    id: 'google-calendar',
    name: 'Google Calendar',
    available: true,
    connectionType: 'oauth',
    configurable: true,
    config: { hasCredentials: true, enabled: true },
    connection: { status: 'connected', scopes: ['openid'], connectedAt: '2026-09-25T14:59:20.969Z' },
    connections: [
      {
        id: 'conn-1',
        label: 'owner@example.com',
        status: 'connected',
        scopes: ['openid'],
        accessToken: 'ya29.secret-access-token',
        refreshToken: 'secret-refresh-token',
        metadata: { avatarUrl: 'https://example.com/a.png' },
        connectedAt: '2026-09-25T14:59:20.969Z',
      },
    ],
    credentialStubs: [{ name: 'GOOGLE_TOKEN', value: 'stub-secret' }],
  },
  {
    id: 'github',
    name: 'GitHub',
    available: true,
    connectionType: 'oauth',
    configurable: true,
    config: null,
    connection: null,
    connections: [],
    credentialStubs: [],
  },
  {
    id: 'slack',
    name: 'Slack',
    available: false,
    connectionType: 'cloud_only',
    configurable: false,
    config: null,
    connection: null,
    connections: [],
    credentialStubs: [],
  },
];

async function startFakeOnecli(status = 200): Promise<FakeOnecli> {
  const server = http.createServer((req, res) => {
    if (req.url === '/v1/apps') {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(APPS));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

let h: Harness;
let onecli: FakeOnecli | null = null;

afterEach(async () => {
  await stopConsole();
  await onecli?.close();
  onecli = null;
});

describe('Console Connected Accounts', () => {
  it('lists connected apps with their accounts and offers a dashboard link for the rest', async () => {
    onecli = await startFakeOnecli();
    h = await startConsole({ onecli: { url: onecli.url } });

    expect(await h.api('/api/connected-accounts')).toEqual({
      apps: [
        {
          provider: 'google-calendar',
          name: 'Google Calendar',
          connectUrl: `${onecli.url}/connections?connect=google-calendar`,
          accounts: [{ label: 'owner@example.com', status: 'connected', connectedAt: '2026-09-25T14:59:20.969Z' }],
        },
        {
          provider: 'github',
          name: 'GitHub',
          connectUrl: `${onecli.url}/connections?connect=github`,
          accounts: [],
        },
      ],
    });
  });

  it('never passes credentials from OneCLI through to the browser', async () => {
    onecli = await startFakeOnecli();
    h = await startConsole({ onecli: { url: onecli.url } });

    const raw = JSON.stringify(await h.api('/api/connected-accounts'));

    expect(raw).not.toMatch(/accessToken|refreshToken|secret|credentialStubs|scopes|conn-1/);
  });

  it('tells the browser that the entry exists when the gateway is OneCLI', async () => {
    onecli = await startFakeOnecli();
    h = await startConsole({ onecli: { url: onecli.url } });

    expect(await h.api('/api/settings')).toMatchObject({ connectedAccounts: true });
  });

  it('opens the dashboard the operator named instead of the API origin', async () => {
    onecli = await startFakeOnecli();
    h = await startConsole({ onecli: { url: onecli.url, dashboardUrl: 'https://onecli.example.com/connections' } });

    const { apps } = await h.api<{ apps: Array<{ connectUrl: string }> }>('/api/connected-accounts');

    expect(apps[1].connectUrl).toBe('https://onecli.example.com/connections?connect=github');
  });

  it('answers 502 when OneCLI cannot be reached, and the rest of the Console keeps working', async () => {
    onecli = await startFakeOnecli();
    const url = onecli.url;
    await onecli.close();
    onecli = null;
    h = await startConsole({ onecli: { url } });

    await expect(h.api('/api/connected-accounts')).rejects.toThrow(/→ 502 .*OneCLI/);
    expect(await h.api('/api/agent-groups')).toHaveLength(2);
  });

  it('answers 502 when OneCLI answers with an error', async () => {
    onecli = await startFakeOnecli(500);
    h = await startConsole({ onecli: { url: onecli.url } });

    await expect(h.api('/api/connected-accounts')).rejects.toThrow(/→ 502 /);
  });

  it('has no entry and no endpoint when the gateway is not OneCLI', async () => {
    h = await startConsole();

    expect(await h.api('/api/settings')).toMatchObject({ connectedAccounts: false });
    await expect(h.api('/api/connected-accounts')).rejects.toThrow(/→ 404 /);
  });
});

describe('reading the OneCLI endpoint from the environment', () => {
  it('uses ONECLI_URL when the gateway is OneCLI', () => {
    expect(
      onecliEndpointFromEnv({ NANOCLAW_GATEWAY_PROVIDER: 'OneCLI', ONECLI_URL: 'http://127.0.0.1:10254' }),
    ).toEqual({ url: 'http://127.0.0.1:10254' });
  });

  it('passes ONECLI_API_KEY along when there is one', () => {
    expect(
      onecliEndpointFromEnv({ NANOCLAW_GATEWAY_PROVIDER: 'onecli', ONECLI_URL: 'http://x:1', ONECLI_API_KEY: 'k' }),
    ).toEqual({ url: 'http://x:1', apiKey: 'k' });
  });

  it('ignores a leftover ONECLI_URL when another gateway is selected', () => {
    expect(
      onecliEndpointFromEnv({ NANOCLAW_GATEWAY_PROVIDER: 'iron-proxy', ONECLI_URL: 'http://127.0.0.1:10254' }),
    ).toBeNull();
  });

  it('links to ONECLI_CONSOLE_URL when the operator set one', () => {
    expect(
      onecliEndpointFromEnv({
        NANOCLAW_GATEWAY_PROVIDER: 'onecli',
        ONECLI_URL: 'http://127.0.0.1:10254',
        ONECLI_CONSOLE_URL: 'https://onecli.example.com/',
      }),
    ).toEqual({ url: 'http://127.0.0.1:10254', dashboardUrl: 'https://onecli.example.com/' });
  });

  it('needs ONECLI_URL', () => {
    expect(onecliEndpointFromEnv({ NANOCLAW_GATEWAY_PROVIDER: 'onecli' })).toBeNull();
  });
});
