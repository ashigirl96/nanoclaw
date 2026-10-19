import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChannelAdapter, ChannelSetup } from '../adapter.js';
import {
  createChannelDeliveryAdapter,
  getChannelAdapterExact,
  initChannelAdapters,
  registerChannelAdapter,
  teardownChannelAdapters,
} from '../channel-registry.js';
import { closeDb, initTestDb, runMigrations } from '../../db/index.js';
import { createAgentGroup } from '../../db/agent-groups.js';
import { createMessagingGroup, getMessagingGroupByPlatform } from '../../db/messaging-groups.js';
import { createSession } from '../../db/sessions.js';
import { setDeliveryAdapter } from '../../delivery.js';
import { requestApproval } from '../../modules/approvals/primitive.js';
import { upsertUser } from '../../modules/permissions/db/users.js';
import { grantRole } from '../../modules/permissions/db/user-roles.js';
import type { Session } from '../../types.js';
import { createConsoleAdapter, type ConsoleAdapter } from './adapter.js';

vi.mock('../../container-runner.js', () => ({ wakeContainer: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../session-manager.js', async () => {
  const actual = await vi.importActual<typeof import('../../session-manager.js')>('../../session-manager.js');
  return { ...actual, writeSessionMessage: vi.fn() };
});

interface Action {
  questionId: string;
  value: string;
  userId: string;
  messageId?: string;
  platformId?: string;
}

let tmp: string;
let actions: Action[];
const slackDeliveries: Array<{ platformId: string; content: unknown }> = [];

const fakeSlack: ChannelAdapter = {
  name: 'slack',
  channelType: 'slack',
  supportsThreads: true,
  async setup() {},
  async teardown() {},
  isConnected: () => true,
  async deliver(platformId, _threadId, message) {
    slackDeliveries.push({ platformId, content: message.content });
    return 'slack-ts-1';
  },
};

function recorder(): ChannelSetup {
  return {
    onInbound: () => {},
    onInboundEvent: () => {},
    onMetadata: () => {},
    onAction: (questionId, value, userId, address) => {
      actions.push({ questionId, value, userId, messageId: address?.messageId, platformId: address?.platformId });
    },
  };
}

function consoleAdapter(): ConsoleAdapter {
  return getChannelAdapterExact('web') as ConsoleAdapter;
}

async function api<T = unknown>(pathname: string, init?: RequestInit): Promise<T> {
  const res = await fetch(consoleAdapter().url() + pathname, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  if (!res.ok) throw new Error(`${pathname} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

interface InboxMessage {
  id: string;
  agentGroupId: string | null;
  card: {
    type: string;
    title: string;
    question: string;
    options: Array<{ label: string; value: string }>;
    resolution: string | null;
  } | null;
}

async function inbox(): Promise<InboxMessage[]> {
  return api<InboxMessage[]>('/api/inbox');
}

function sessionIn(id: string, messagingGroupId: string): Session {
  const now = new Date().toISOString();
  return {
    id,
    agent_group_id: 'ag-a',
    messaging_group_id: messagingGroupId,
    thread_id: null,
    agent_provider: null,
    status: 'active',
    container_status: 'running',
    last_active: now,
    created_at: now,
  };
}

async function askApproval(session: Session): Promise<void> {
  await createSession(session);
  await requestApproval({
    session,
    agentName: 'Alice',
    action: 'install_packages',
    payload: { apt: ['jq'] },
    title: 'Install packages',
    question: 'Alice wants to install jq',
  });
}

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'console-inbox-test-'));
  actions = [];
  slackDeliveries.length = 0;
  const db = await initTestDb();
  await runMigrations(db);
  await createAgentGroup({
    id: 'ag-a',
    name: 'Alice',
    folder: 'alice',
    agent_provider: null,
    created_at: '2026-10-01T00:00:00.000Z',
  });

  // A Slack Owner already exists, granted before the Console's Owner.
  await upsertUser({
    id: 'slack:U1',
    kind: 'slack',
    display_name: 'Slack Owner',
    created_at: '2026-10-01T00:00:00.000Z',
  });
  await grantRole({
    user_id: 'slack:U1',
    role: 'owner',
    agent_group_id: null,
    granted_by: null,
    granted_at: '2026-10-01T00:00:00.000Z',
  });
  await createMessagingGroup({
    id: 'mg-slack',
    channel_type: 'slack',
    platform_id: 'slack:C1',
    instance: 'slack',
    name: 'general',
    is_group: 1,
    unknown_sender_policy: 'strict',
    created_at: '2026-10-01T00:00:00.000Z',
  });

  registerChannelAdapter('web', { factory: () => createConsoleAdapter({ port: 0, dataDir: tmp, distDir: tmp }) });
  registerChannelAdapter('slack', { factory: () => fakeSlack });
  await initChannelAdapters(recorder);
  setDeliveryAdapter(createChannelDeliveryAdapter());

  await api('/api/agent-groups/ag-a/open', { method: 'POST', body: '{}' });
});

afterEach(async () => {
  await teardownChannelAdapters();
  await closeDb();
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function consoleMessagingGroupId(): Promise<string> {
  return (await getMessagingGroupByPlatform('web', 'web:ag-a'))!.id;
}

describe('Approval Requests', () => {
  it('shows a request from a Console session in the Inbox', async () => {
    await askApproval(sessionIn('sess-web', await consoleMessagingGroupId()));

    const messages = await inbox();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      agentGroupId: null,
      card: {
        type: 'approval',
        title: 'Install packages',
        question: 'Alice wants to install jq',
        resolution: null,
      },
    });
    expect(messages[0].card!.options.map((o) => o.value)).toEqual(['approve', 'reject', 'reject_with_reason']);
    expect(slackDeliveries).toHaveLength(0);
  });

  it('still sends a request from a Slack session to Slack', async () => {
    await askApproval(sessionIn('sess-slack', 'mg-slack'));

    expect(slackDeliveries).toHaveLength(1);
    expect(slackDeliveries[0].content).toMatchObject({ type: 'ask_question', title: 'Install packages' });
    expect(await inbox()).toEqual([]);
  });
});
