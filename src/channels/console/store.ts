import { createHash } from 'crypto';

import Database from 'better-sqlite3';

import type { Card } from './cards.js';

export type Role = 'owner' | 'agent';

export interface StoredFile {
  id: string;
  name: string;
  mimeType: string;
}

export interface LibraryFile extends StoredFile {
  messageId: string;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  chatId: string;
  /** The Agent Group that sent it; null for the Owner and for the Inbox. */
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

export interface GroupChat {
  id: string;
  name: string;
  createdAt: string;
}

export type AvatarSource = 'upload' | 'slack';

export interface Image {
  mimeType: string;
  data: Buffer;
}

export interface Appearance {
  label: string | null;
  /** The Avatar shown, upload first; null when neither is stored. `version` changes whenever its bytes do. */
  avatar: { source: AvatarSource; version: string } | null;
  hasSlackAvatar: boolean;
}

interface AppearanceRow {
  label: string | null;
  uploaded_avatar_version: string | null;
  slack_avatar_version: string | null;
}

const AVATAR_COLUMNS: Record<AvatarSource, { type: string; data: string; version: string }> = {
  upload: { type: 'uploaded_avatar_type', data: 'uploaded_avatar', version: 'uploaded_avatar_version' },
  slack: { type: 'slack_avatar_type', data: 'slack_avatar', version: 'slack_avatar_version' },
};

interface MessageRow {
  id: string;
  chat_id: string;
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
  `CREATE TABLE read_positions (
     agent_group_id TEXT PRIMARY KEY,
     last_read_seq INTEGER NOT NULL
   );`,
  `ALTER TABLE messages ADD COLUMN card TEXT;`,
  `ALTER TABLE messages ADD COLUMN chat_id TEXT NOT NULL DEFAULT '';
   UPDATE messages SET chat_id = CASE agent_group_id WHEN '' THEN 'inbox' ELSE 'ag:' || agent_group_id END;
   UPDATE messages SET agent_group_id = '' WHERE role = 'owner';
   DROP INDEX messages_by_agent_group;
   CREATE INDEX messages_by_chat ON messages (chat_id, seq);
   CREATE INDEX messages_by_agent_group ON messages (agent_group_id, seq);
   CREATE TABLE chat_read_positions (
     chat_id TEXT PRIMARY KEY,
     last_read_seq INTEGER NOT NULL
   );
   INSERT INTO chat_read_positions (chat_id, last_read_seq)
     SELECT 'ag:' || agent_group_id, last_read_seq FROM read_positions;
   DROP TABLE read_positions;
   ALTER TABLE chat_read_positions RENAME TO read_positions;
   CREATE TABLE group_chats (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     created_at TEXT NOT NULL
   );
   CREATE TABLE group_chat_members (
     group_chat_id TEXT NOT NULL REFERENCES group_chats (id) ON DELETE CASCADE,
     agent_group_id TEXT NOT NULL,
     joined_at TEXT NOT NULL,
     PRIMARY KEY (group_chat_id, agent_group_id)
   );`,
  `CREATE TABLE agent_group_appearance (
     agent_group_id TEXT PRIMARY KEY,
     label TEXT,
     uploaded_avatar_type TEXT,
     uploaded_avatar BLOB,
     uploaded_avatar_version TEXT,
     slack_avatar_type TEXT,
     slack_avatar BLOB,
     slack_avatar_version TEXT
   );`,
];

// agent_group_id is NOT NULL, and no Agent Group can have an empty id.
const NO_AGENT_GROUP = '';

function versionOf(image: Image): string {
  return createHash('sha256').update(image.mimeType).update(image.data).digest('hex').slice(0, 16);
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
    chatId: string;
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
        .prepare(
          'INSERT INTO messages (id, chat_id, agent_group_id, role, text, card, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          id,
          input.chatId,
          input.agentGroupId ?? NO_AGENT_GROUP,
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

  listMessages(chatId: string): ChatMessage[] {
    const rows = this.db.prepare('SELECT * FROM messages WHERE chat_id = ? ORDER BY seq').all(chatId) as MessageRow[];
    return this.hydrate(rows);
  }

  lastMessage(chatId: string): ChatMessage | null {
    const row = this.db.prepare('SELECT * FROM messages WHERE chat_id = ? ORDER BY seq DESC LIMIT 1').get(chatId) as
      | MessageRow
      | undefined;
    return row ? this.hydrate([row])[0] : null;
  }

  editMessage(chatId: string, id: string, text: string): ChatMessage | null {
    const result = this.db
      .prepare('UPDATE messages SET text = ?, edited_at = ? WHERE id = ? AND chat_id = ?')
      .run(text, new Date().toISOString(), id, chatId);
    return result.changes > 0 ? this.getMessage(id) : null;
  }

  /** A null from `update` leaves the message as it is. */
  updateCard(chatId: string, id: string, update: (card: Card) => Card | null): ChatMessage | null {
    const message = this.getMessage(id);
    if (!message?.card || message.chatId !== chatId) return null;
    const next = update(message.card);
    if (!next) return null;
    this.db.prepare('UPDATE messages SET card = ? WHERE id = ?').run(JSON.stringify(next), id);
    return this.getMessage(id);
  }

  addReaction(chatId: string, id: string, emoji: string): ChatMessage | null {
    const message = this.getMessage(id);
    if (!message || message.chatId !== chatId) return null;
    if (message.reactions.includes(emoji)) return message;
    this.db
      .prepare('UPDATE messages SET reactions = ? WHERE id = ?')
      .run(JSON.stringify([...message.reactions, emoji]), id);
    return this.getMessage(id);
  }

  /** false when the message is not in this Chat. */
  markRead(chatId: string, messageId: string): boolean {
    const row = this.db.prepare('SELECT seq FROM messages WHERE id = ? AND chat_id = ?').get(messageId, chatId) as
      | { seq: number }
      | undefined;
    if (!row) return false;
    this.db
      .prepare(
        `INSERT INTO read_positions (chat_id, last_read_seq) VALUES (?, ?)
         ON CONFLICT (chat_id) DO UPDATE SET last_read_seq = MAX(last_read_seq, excluded.last_read_seq)`,
      )
      .run(chatId, row.seq);
    return true;
  }

  unreadCount(chatId: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM messages
          WHERE chat_id = ? AND role = 'agent'
            AND seq > COALESCE((SELECT last_read_seq FROM read_positions WHERE chat_id = ?), 0)`,
      )
      .get(chatId, chatId) as { n: number };
    return row.n;
  }

  createGroupChat(id: string, name: string, agentGroupIds: string[]): GroupChat {
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db.prepare('INSERT INTO group_chats (id, name, created_at) VALUES (?, ?, ?)').run(id, name, now);
      for (const agentGroupId of agentGroupIds) this.addGroupChatMember(id, agentGroupId);
    })();
    return { id, name, createdAt: now };
  }

  listGroupChats(): GroupChat[] {
    const rows = this.db.prepare('SELECT * FROM group_chats ORDER BY created_at, id').all() as GroupChatRow[];
    return rows.map(groupChatOf);
  }

  getGroupChat(id: string): GroupChat | null {
    const row = this.db.prepare('SELECT * FROM group_chats WHERE id = ?').get(id) as GroupChatRow | undefined;
    return row ? groupChatOf(row) : null;
  }

  /** The messages stay, so a Group Chat made again never collides with them: its id is new. */
  deleteGroupChat(id: string): void {
    this.db.prepare('DELETE FROM group_chats WHERE id = ?').run(id);
  }

  groupChatMembers(id: string): string[] {
    const rows = this.db
      .prepare('SELECT agent_group_id FROM group_chat_members WHERE group_chat_id = ? ORDER BY joined_at, rowid')
      .all(id) as Array<{ agent_group_id: string }>;
    return rows.map((r) => r.agent_group_id);
  }

  addGroupChatMember(id: string, agentGroupId: string): void {
    this.db
      .prepare('INSERT OR IGNORE INTO group_chat_members (group_chat_id, agent_group_id, joined_at) VALUES (?, ?, ?)')
      .run(id, agentGroupId, new Date().toISOString());
  }

  removeGroupChatMember(id: string, agentGroupId: string): void {
    this.db
      .prepare('DELETE FROM group_chat_members WHERE group_chat_id = ? AND agent_group_id = ?')
      .run(id, agentGroupId);
  }

  getFile(id: string): (StoredFile & { data: Buffer }) | null {
    const row = this.db.prepare('SELECT id, name, mime_type, data FROM files WHERE id = ?').get(id) as
      | (FileRow & { data: Buffer })
      | undefined;
    return row ? { id: row.id, name: row.name, mimeType: row.mime_type, data: row.data } : null;
  }

  listAgentFiles(agentGroupId: string): LibraryFile[] {
    const rows = this.db
      .prepare(
        `SELECT f.id, f.message_id, f.name, f.mime_type, m.created_at
           FROM files f JOIN messages m ON m.id = f.message_id
          WHERE m.agent_group_id = ? AND m.role = 'agent'
          ORDER BY m.seq DESC, f.rowid DESC`,
      )
      .all(agentGroupId) as Array<FileRow & { created_at: string }>;
    return rows.map((r) => ({
      id: r.id,
      messageId: r.message_id,
      name: r.name,
      mimeType: r.mime_type,
      createdAt: r.created_at,
    }));
  }

  getAppearance(agentGroupId: string): Appearance {
    const row = this.db
      .prepare(
        'SELECT label, uploaded_avatar_version, slack_avatar_version FROM agent_group_appearance WHERE agent_group_id = ?',
      )
      .get(agentGroupId) as AppearanceRow | undefined;
    const avatar = row?.uploaded_avatar_version
      ? { source: 'upload' as const, version: row.uploaded_avatar_version }
      : row?.slack_avatar_version
        ? { source: 'slack' as const, version: row.slack_avatar_version }
        : null;
    return { label: row?.label ?? null, avatar, hasSlackAvatar: Boolean(row?.slack_avatar_version) };
  }

  setLabel(agentGroupId: string, label: string | null): void {
    this.db
      .prepare(
        `INSERT INTO agent_group_appearance (agent_group_id, label) VALUES (?, ?)
         ON CONFLICT (agent_group_id) DO UPDATE SET label = excluded.label`,
      )
      .run(agentGroupId, label);
  }

  /** A null `image` removes the Avatar from that source. */
  setAvatar(agentGroupId: string, source: AvatarSource, image: Image | null): void {
    const c = AVATAR_COLUMNS[source];
    this.db
      .prepare(
        `INSERT INTO agent_group_appearance (agent_group_id, ${c.type}, ${c.data}, ${c.version}) VALUES (?, ?, ?, ?)
         ON CONFLICT (agent_group_id) DO UPDATE
           SET ${c.type} = excluded.${c.type}, ${c.data} = excluded.${c.data}, ${c.version} = excluded.${c.version}`,
      )
      .run(agentGroupId, image?.mimeType ?? null, image?.data ?? null, image ? versionOf(image) : null);
  }

  getAvatar(agentGroupId: string): (Image & { version: string }) | null {
    const avatar = this.getAppearance(agentGroupId).avatar;
    if (!avatar) return null;
    const c = AVATAR_COLUMNS[avatar.source];
    const row = this.db
      .prepare(`SELECT ${c.type} AS mime_type, ${c.data} AS data FROM agent_group_appearance WHERE agent_group_id = ?`)
      .get(agentGroupId) as { mime_type: string; data: Buffer };
    return { mimeType: row.mime_type, data: row.data, version: avatar.version };
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
      chatId: row.chat_id,
      agentGroupId: row.agent_group_id === NO_AGENT_GROUP ? null : row.agent_group_id,
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

interface GroupChatRow {
  id: string;
  name: string;
  created_at: string;
}

function groupChatOf(row: GroupChatRow): GroupChat {
  return { id: row.id, name: row.name, createdAt: row.created_at };
}
