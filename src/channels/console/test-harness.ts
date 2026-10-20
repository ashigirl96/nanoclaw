import fs from 'fs';
import os from 'os';
import path from 'path';

import type { ChannelSetup } from '../adapter.js';
import { closeDb, initTestDb, runMigrations } from '../../db/index.js';
import { createAgentGroup } from '../../db/agent-groups.js';
import { createConsoleAdapter, type ConsoleAdapter, type ConsoleOptions } from './adapter.js';

export interface Harness {
  adapter: ConsoleAdapter;
  api<T = unknown>(pathname: string, init?: RequestInit): Promise<T>;
  openEvents(): Promise<EventStream>;
  restart(): Promise<void>;
}

export interface EventStream {
  next(count: number): Promise<unknown[]>;
  /** The next `count` events of one type, skipping the others. */
  ofType(type: string, count: number): Promise<unknown[]>;
  close(): void;
}

let tmp: string | null = null;
let current: ConsoleAdapter | null = null;

const silentSetup: ChannelSetup = {
  onInbound: () => {},
  onInboundEvent: () => {},
  onMetadata: () => {},
  onAction: () => {},
};

/** A fresh central DB with Agent Groups ag-a (Alice) and ag-b (Bob), and a running Console. */
export async function startConsole(opts: Pick<ConsoleOptions, 'onecli'> = {}): Promise<Harness> {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'console-test-'));
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

  async function boot(): Promise<void> {
    current = createConsoleAdapter({ port: 0, dataDir: tmp!, distDir: path.join(tmp!, 'dist'), ...opts });
    await current.setup(silentSetup);
  }
  await boot();

  const harness: Harness = {
    get adapter() {
      return current!;
    },
    async api<T>(pathname: string, init?: RequestInit): Promise<T> {
      const res = await fetch(current!.url() + pathname, {
        ...init,
        headers: { 'content-type': 'application/json', ...init?.headers },
      });
      if (!res.ok) throw new Error(`${pathname} → ${res.status} ${await res.text()}`);
      return (await res.json()) as T;
    },
    openEvents: () => openEvents(current!.url()),
    async restart() {
      await current!.teardown();
      await boot();
    },
  };
  return harness;
}

export async function stopConsole(): Promise<void> {
  await current?.teardown();
  current = null;
  await closeDb();
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = null;
}

export async function openEvents(baseUrl: string): Promise<EventStream> {
  const controller = new AbortController();
  const res = await fetch(baseUrl + '/api/events', { signal: controller.signal });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const received: unknown[] = [];
  const stream: EventStream = {
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
      return received.splice(0, count);
    },
    async ofType(type: string, count: number): Promise<unknown[]> {
      const matched: unknown[] = [];
      while (matched.length < count) {
        const [event] = await stream.next(1);
        if (event === undefined) break;
        if ((event as { type: string }).type === type) matched.push(event);
      }
      return matched;
    },
    close: () => controller.abort(),
  };
  return stream;
}
