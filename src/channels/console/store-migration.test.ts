import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConsoleStore } from './store.js';

let tmp: string;
let dbPath: string;

/** A console.db as the Console wrote it before Chats had their own id (schema version 3). */
function writeVersion3(): void {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE messages (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      agent_group_id TEXT NOT NULL,
      role TEXT NOT NULL,
      text TEXT NOT NULL,
      reactions TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      edited_at TEXT
    );
    CREATE INDEX messages_by_agent_group ON messages (agent_group_id, seq);
    CREATE TABLE files (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL REFERENCES messages (id),
      name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      data BLOB NOT NULL
    );
    CREATE INDEX files_by_message ON files (message_id);
    CREATE TABLE read_positions (
      agent_group_id TEXT PRIMARY KEY,
      last_read_seq INTEGER NOT NULL
    );
    ALTER TABLE messages ADD COLUMN card TEXT;
    PRAGMA user_version = 3;
  `);
  const insert = db.prepare('INSERT INTO messages (id, agent_group_id, role, text, created_at) VALUES (?, ?, ?, ?, ?)');
  insert.run('m1', 'ag-a', 'owner', 'こんにちは', '2026-10-01T00:00:00.000Z');
  insert.run('m2', 'ag-a', 'agent', 'はい', '2026-10-01T00:00:01.000Z');
  insert.run('m3', 'ag-a', 'agent', '続きです', '2026-10-01T00:00:02.000Z');
  insert.run('m4', '', 'agent', '承認してください', '2026-10-01T00:00:03.000Z');
  insert.run('m5', 'ag-b', 'agent', 'Bob です', '2026-10-01T00:00:04.000Z');
  db.prepare('INSERT INTO files (id, message_id, name, mime_type, data) VALUES (?, ?, ?, ?, ?)').run(
    'f1',
    'm3',
    'report.md',
    'text/markdown',
    Buffer.from('# report'),
  );
  db.prepare('INSERT INTO read_positions (agent_group_id, last_read_seq) VALUES (?, ?)').run('ag-a', 2);
  db.close();
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'console-store-migration-'));
  dbPath = path.join(tmp, 'console.db');
  writeVersion3();
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('opening a console.db from before Group Chats', () => {
  it("keeps each Agent Group's Chat history, with the Owner's messages from no Agent", () => {
    const store = new ConsoleStore(dbPath);

    expect(store.listMessages('ag:ag-a').map((m) => [m.id, m.role, m.agentGroupId, m.text])).toEqual([
      ['m1', 'owner', null, 'こんにちは'],
      ['m2', 'agent', 'ag-a', 'はい'],
      ['m3', 'agent', 'ag-a', '続きです'],
    ]);
    expect(store.listMessages('ag:ag-b').map((m) => m.id)).toEqual(['m5']);
    store.close();
  });

  it('keeps the Inbox history', () => {
    const store = new ConsoleStore(dbPath);

    expect(store.listMessages('inbox').map((m) => [m.id, m.agentGroupId, m.text])).toEqual([
      ['m4', null, '承認してください'],
    ]);
    store.close();
  });

  it('keeps the unread counts', () => {
    const store = new ConsoleStore(dbPath);

    expect(store.unreadCount('ag:ag-a')).toBe(1);
    expect(store.unreadCount('ag:ag-b')).toBe(1);
    store.close();
  });

  it("keeps the files in the Agent Group's Library", () => {
    const store = new ConsoleStore(dbPath);

    expect(store.listAgentFiles('ag-a').map((f) => [f.messageId, f.name])).toEqual([['m3', 'report.md']]);
    store.close();
  });
});
