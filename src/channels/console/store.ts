import Database from 'better-sqlite3';

import type { Card } from './cards.js';

export type Role = 'owner' | 'agent';

export interface StoredFile {
  id: string;
  name: string;
  mimeType: string;
}

export interface ChatMessage {
  id: string;
  /** null for the Inbox, which belongs to no Agent Group. */
  agentGroupId: string | null;
  role: Role;
  text: string;
  card: Card | null;
  reactions: string[];
  files: StoredFile[];
  createdAt: string;
  editedAt: string | null;
}

export interface NewFile {
  name: string;
  mimeType: string;
  data: Buffer;
}

interface MessageRow {
  id: string;
  agent_group_id: string;
  role: Role;
  text: string;
  card: string | null;
  reactions: string;
  created_at: string;
  edited_at: string | null;
}

interface FileRow {
  id: string;
  message_id: string;
  name: string;
  mime_type: string;
}

// Each entry moves the schema from version i to i + 1; append only.
const MIGRATIONS = [
  `CREATE TABLE messages (
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
   CREATE INDEX files_by_message ON files (message_id);`,
  `ALTER TABLE messages ADD COLUMN card TEXT;`,
];

// agent_group_id is NOT NULL, and no Agent Group can have an empty id.
const INBOX_KEY = '';

function chatKey(agentGroupId: string | null): string {
  return agentGroupId ?? INBOX_KEY;
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** The Console's own record of every Chat — the source of truth for what the Owner sees (ADR 0001). */
export class ConsoleStore {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    const version = this.db.pragma('user_version', { simple: true }) as number;
    for (let v = version; v < MIGRATIONS.length; v++) {
      this.db.transaction(() => {
        this.db.exec(MIGRATIONS[v]);
        this.db.pragma(`user_version = ${v + 1}`);
      })();
    }
  }

  addMessage(input: {
    agentGroupId: string | null;
    role: Role;
    text: string;
    files?: NewFile[];
    card?: Card;
  }): ChatMessage {
    const id = newId('msg');
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db
        .prepare('INSERT INTO messages (id, agent_group_id, role, text, card, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(
          id,
          chatKey(input.agentGroupId),
          input.role,
          input.text,
          input.card ? JSON.stringify(input.card) : null,
          now,
        );
      const insertFile = this.db.prepare(
        'INSERT INTO files (id, message_id, name, mime_type, data) VALUES (?, ?, ?, ?, ?)',
      );
      for (const f of input.files ?? []) insertFile.run(newId('file'), id, f.name, f.mimeType, f.data);
    })();
    return this.getMessage(id)!;
  }

  getMessage(id: string): ChatMessage | null {
    const row = this.db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as MessageRow | undefined;
    return row ? this.hydrate([row])[0] : null;
  }

  listMessages(agentGroupId: string | null): ChatMessage[] {
    const rows = this.db
      .prepare('SELECT * FROM messages WHERE agent_group_id = ? ORDER BY seq')
      .all(chatKey(agentGroupId)) as MessageRow[];
    return this.hydrate(rows);
  }

  lastMessage(agentGroupId: string): ChatMessage | null {
    const row = this.db
      .prepare('SELECT * FROM messages WHERE agent_group_id = ? ORDER BY seq DESC LIMIT 1')
      .get(agentGroupId) as MessageRow | undefined;
    return row ? this.hydrate([row])[0] : null;
  }

  editMessage(agentGroupId: string | null, id: string, text: string): ChatMessage | null {
    const result = this.db
      .prepare('UPDATE messages SET text = ?, edited_at = ? WHERE id = ? AND agent_group_id = ?')
      .run(text, new Date().toISOString(), id, chatKey(agentGroupId));
    return result.changes > 0 ? this.getMessage(id) : null;
  }

  setCard(agentGroupId: string | null, id: string, card: Card): ChatMessage | null {
    const result = this.db
      .prepare('UPDATE messages SET card = ? WHERE id = ? AND agent_group_id = ?')
      .run(JSON.stringify(card), id, chatKey(agentGroupId));
    return result.changes > 0 ? this.getMessage(id) : null;
  }

  addReaction(agentGroupId: string | null, id: string, emoji: string): ChatMessage | null {
    const message = this.getMessage(id);
    if (!message || message.agentGroupId !== agentGroupId) return null;
    if (message.reactions.includes(emoji)) return message;
    this.db
      .prepare('UPDATE messages SET reactions = ? WHERE id = ?')
      .run(JSON.stringify([...message.reactions, emoji]), id);
    return this.getMessage(id);
  }

  getFile(id: string): (StoredFile & { data: Buffer }) | null {
    const row = this.db.prepare('SELECT id, name, mime_type, data FROM files WHERE id = ?').get(id) as
      | (FileRow & { data: Buffer })
      | undefined;
    return row ? { id: row.id, name: row.name, mimeType: row.mime_type, data: row.data } : null;
  }

  close(): void {
    this.db.close();
  }

  private hydrate(rows: MessageRow[]): ChatMessage[] {
    const filesOf = this.db.prepare(
      'SELECT id, message_id, name, mime_type FROM files WHERE message_id = ? ORDER BY rowid',
    );
    return rows.map((row) => ({
      id: row.id,
      agentGroupId: row.agent_group_id === INBOX_KEY ? null : row.agent_group_id,
      role: row.role,
      text: row.text,
      card: row.card ? (JSON.parse(row.card) as Card) : null,
      reactions: JSON.parse(row.reactions) as string[],
      files: (filesOf.all(row.id) as FileRow[]).map((f) => ({ id: f.id, name: f.name, mimeType: f.mime_type })),
      createdAt: row.created_at,
      editedAt: row.edited_at,
    }));
  }
}
