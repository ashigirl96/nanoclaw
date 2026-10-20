import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

import type { ChannelAdapter, ChannelSetup } from './channels/adapter.js';
import { createConsoleAdapter, type ConsoleAdapter } from './channels/console/adapter.js';
import { createAgentGroup } from './db/agent-groups.js';
import { closeDb, initTestDb, runMigrations } from './db/index.js';
import { getMessagingGroupByPlatform } from './db/messaging-groups.js';
import { findSessionForAgent } from './db/sessions.js';
import { wakeContainer } from './container-runner.js';
import { inboundDbPath } from './mailbox/sqlite/paths.js';
import { log } from './log.js';
import { routeInbound } from './router.js';

const state = vi.hoisted(() => ({
  hostSetup: undefined as ((adapter: ChannelAdapter) => ChannelSetup) | undefined,
  ready: undefined as (() => void) | undefined,
}));

vi.mock('./config.js', async () => ({
  ...(await vi.importActual('./config.js')),
  DATA_DIR: '/tmp/nanoclaw-test-host-inbound-wait',
}));
vi.mock('./backfill-container-configs.js', () => ({ backfillContainerConfigs: vi.fn() }));
vi.mock('./circuit-breaker.js', () => ({ enforceStartupBackoff: vi.fn(), resetCircuitBreaker: vi.fn() }));
vi.mock('./upgrade-state.js', () => ({ enforceUpgradeTripwire: vi.fn() }));
vi.mock('./db/connection.js', async () => {
  const actual = await vi.importActual<typeof import('./db/connection.js')>('./db/connection.js');
  return { ...actual, initDb: async () => actual.getDb() };
});
vi.mock('./drivers/index.js', async () => ({
  ...(await vi.importActual('./drivers/index.js')),
  getSessionDriver: () => ({ ensureReady: vi.fn() }),
}));
vi.mock('./container-runner.js', () => ({
  wakeContainer: vi.fn().mockResolvedValue(true),
  isContainerRunning: vi.fn().mockReturnValue(false),
  getActiveContainerCount: vi.fn().mockReturnValue(0),
  killContainer: vi.fn(),
  adoptRunningSessions: vi.fn(),
  abortGatewaySessionObservers: vi.fn(),
  resumeGatewaySessionAdmission: vi.fn(),
  stopGatewaySessionsForUnavailability: vi.fn(),
}));
vi.mock('./host-instance.js', () => ({ startHostInstanceLease: vi.fn(), stopHostInstanceLease: vi.fn() }));
vi.mock('./gateway-providers/index.js', () => ({ getGatewayProvider: () => ({}), resetGatewayProvider: vi.fn() }));
vi.mock('./gateway-availability.js', () => ({ startGatewayAvailabilityMonitor: vi.fn() }));
vi.mock('./gateway-approval-coordinator.js', () => ({
  startGatewayApprovalCoordinator: vi.fn(),
  stopGatewayApprovalCoordinator: vi.fn(),
}));
vi.mock('./delivery.js', async () => ({
  ...(await vi.importActual('./delivery.js')),
  startActiveDeliveryPoll: vi.fn(),
  startSweepDeliveryPoll: vi.fn(),
}));
vi.mock('./host-sweep.js', () => ({ startHostSweep: vi.fn(), stopHostSweep: vi.fn() }));
vi.mock('./host-lifecycle.js', async () => ({
  ...(await vi.importActual('./host-lifecycle.js')),
  startHostModules: vi.fn(),
  stopHostModules: vi.fn(),
}));
vi.mock('./router.js', async () => {
  const actual = await vi.importActual<typeof import('./router.js')>('./router.js');
  return { ...actual, routeInbound: vi.fn(actual.routeInbound) };
});
vi.mock('./channels/index.js', () => ({}));
vi.mock('./cli/commands/index.js', () => ({}));
vi.mock('./cli/delivery-action.js', () => ({}));
vi.mock('./cli/socket-server.js', () => ({ startCliServer: () => state.ready!(), stopCliServer: vi.fn() }));
vi.mock('./channels/channel-registry.js', async () => ({
  ...(await vi.importActual('./channels/channel-registry.js')),
  initChannelAdapters: async (setup: (adapter: ChannelAdapter) => ChannelSetup) => {
    state.hostSetup = setup;
  },
}));

const SESSIONS_DIR = '/tmp/nanoclaw-test-host-inbound-wait';

let consoleDir: string;
let adapter: ConsoleAdapter;

async function post<T>(pathname: string, body: unknown): Promise<T> {
  const res = await fetch(adapter.url() + pathname, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${pathname} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

function hostSetup(): ChannelSetup {
  return state.hostSetup!(adapter);
}

async function sessionTexts(agentGroupId: string, platformId: string): Promise<string[]> {
  const mg = await getMessagingGroupByPlatform('web', platformId);
  const session = mg ? await findSessionForAgent(agentGroupId, mg.id, null) : undefined;
  if (!session) return [];
  const db = new Database(inboundDbPath(agentGroupId, session.id), { readonly: true });
  try {
    const rows = db.prepare('SELECT content FROM messages_in ORDER BY seq').all() as Array<{ content: string }>;
    return rows.map((r) => (JSON.parse(r.content) as { text: string }).text);
  } finally {
    db.close();
  }
}

beforeAll(async () => {
  vi.spyOn(process, 'on').mockReturnValue(process);
  fs.rmSync(SESSIONS_DIR, { recursive: true, force: true });
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  consoleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'host-inbound-wait-test-'));
  await runMigrations(await initTestDb());
  for (const [id, name, folder] of [
    ['ag-a', 'Alice', 'alice'],
    ['ag-b', 'Bob', 'bob'],
    ['ag-c', 'Carol', 'carol'],
  ]) {
    await createAgentGroup({ id, name, folder, agent_provider: null, created_at: '2026-10-01T00:00:00.000Z' });
  }
  const running = new Promise<void>((resolve) => {
    state.ready = resolve;
  });
  await import('./index.js');
  await running;
  adapter = createConsoleAdapter({ port: 0, dataDir: consoleDir, distDir: path.join(consoleDir, 'dist') });
  await adapter.setup(hostSetup());
});

afterAll(async () => {
  await adapter?.teardown();
  await closeDb();
  fs.rmSync(consoleDir, { recursive: true, force: true });
  fs.rmSync(SESSIONS_DIR, { recursive: true, force: true });
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.mocked(wakeContainer).mockClear();
  vi.mocked(routeInbound).mockReset();
});

it("puts the Owner's message in every unmentioned Session before the mentioned one's", async () => {
  const chat = await post<{ id: string }>('/api/group-chats', {
    name: '相談',
    agentGroupIds: ['ag-a', 'ag-b', 'ag-c'],
  });
  const { routeInbound: realRouteInbound } = await vi.importActual<typeof import('./router.js')>('./router.js');
  // Slow context deliveries let an unawaited Mention overtake them.
  vi.mocked(routeInbound).mockImplementation(async (event) => {
    if (!event.message.isMention) await new Promise((resolve) => setTimeout(resolve, 30));
    await realRouteInbound(event);
  });
  let othersAtWake: string[][] = [];
  vi.mocked(wakeContainer).mockImplementationOnce(async () => {
    othersAtWake = [
      await sessionTexts('ag-b', `web:gc:${chat.id}:ag-b`),
      await sessionTexts('ag-c', `web:gc:${chat.id}:ag-c`),
    ];
    return true;
  });

  await post(`/api/group-chats/${chat.id}/messages`, { text: '@Alice 調べて' });

  expect(vi.mocked(wakeContainer).mock.calls.map(([s]) => s.agent_group_id)).toEqual(['ag-a']);
  expect(othersAtWake).toEqual([['@Alice 調べて'], ['@Alice 調べて']]);
});

it('resolves onInboundEvent only after routing finishes', async () => {
  let finishRouting!: () => void;
  vi.mocked(routeInbound).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finishRouting = resolve;
      }),
  );
  let settled = false;

  const pending = Promise.resolve(
    hostSetup().onInboundEvent({
      channelType: 'web',
      instance: 'web',
      platformId: 'web:ag-a',
      threadId: null,
      message: { id: 'e', kind: 'chat', content: '{}', timestamp: new Date().toISOString() },
    }),
  ).then(() => {
    settled = true;
  });
  await vi.waitFor(() => expect(finishRouting).toBeDefined());
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(settled).toBe(false);
  finishRouting();
  await pending;
  expect(settled).toBe(true);
});

it('settles with a log instead of rejecting when routing throws', async () => {
  vi.mocked(routeInbound).mockRejectedValue(new Error('boom'));
  const error = vi.spyOn(log, 'error').mockImplementation(() => {});
  const timestamp = new Date().toISOString();

  await expect(
    hostSetup().onInbound('web:ag-a', null, { id: 'm', kind: 'chat', content: {}, timestamp }),
  ).resolves.toBeUndefined();
  await expect(
    hostSetup().onInboundEvent({
      channelType: 'web',
      instance: 'web',
      platformId: 'web:ag-a',
      threadId: null,
      message: { id: 'e', kind: 'chat', content: '{}', timestamp },
    }),
  ).resolves.toBeUndefined();
  expect(error.mock.calls.map(([msg]) => msg)).toEqual([
    'Failed to route inbound message',
    'Failed to route inbound event',
  ]);
});
