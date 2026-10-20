import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { type Activity, type ChatMessage, type Member, type Upload, readUpload } from './api';
import { Avatar } from './Avatar';
import { connectLinksIn } from './apps';
import { CardView } from './Card';
import { AppConnectCard } from './ConnectApps';
import { FilePreview } from './FilePreview';
import { ArrowUpIcon, PlusIcon } from './Icons';
import { Markdown } from './Markdown';
import { startsNewStretch, useFormatDivider } from './time';

export interface Worker extends Member {
  activity: Activity;
}

interface Props {
  title: ReactNode;
  messages: ChatMessage[];
  /** Who is working in this Chat now; a Group Chat names each of them. */
  working: Worker[];
  send: (text: string, uploads: Upload[]) => Promise<ChatMessage>;
  onSent: (message: ChatMessage) => void;
  onError: (message: string) => void;
  /** The participants of a Group Chat, offered when the Owner types `@`. */
  members?: Member[];
  /** Set in a Group Chat, where each Agent message shows who sent it, even after they left. */
  nameOf?: (agentGroupId: string) => string;
}

export function Chat({ title, messages, working, send, onSent, onError, members, nameOf }: Props) {
  const bottom = useRef<HTMLDivElement>(null);
  const busy = working.length > 0;
  const authorOf = nameOf && ((id: string) => ({ id, name: nameOf(id) }));

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, busy]);

  return (
    <section className="chat">
      <div className="chat-scroll">
        <div className="chat-title">{title}</div>
        <Thread messages={messages} onAnswered={onSent} onError={onError} authorOf={authorOf} />
        {busy && (
          <div className="thread">
            {working.map((w) => (
              <div key={w.id} className="working" role="status">
                <span className="working-dot" />
                {members && `${w.name}: `}
                {w.activity.tool ? `${w.activity.tool} を実行中…` : '作業中…'}
              </div>
            ))}
          </div>
        )}
        <div ref={bottom} />
      </div>
      <Composer send={send} onSent={onSent} onError={onError} members={members} />
    </section>
  );
}

export function Thread({
  messages,
  onAnswered,
  onError,
  authorOf,
}: {
  messages: ChatMessage[];
  onAnswered: (message: ChatMessage) => void;
  onError: (message: string) => void;
  /** Set in a Group Chat, where each Agent message shows who sent it. */
  authorOf?: (agentGroupId: string) => Member;
}) {
  const formatDivider = useFormatDivider();
  return (
    <div className="thread">
      {messages.map((m, i) => (
        <div key={m.id} className="thread-item">
          {startsNewStretch(messages[i - 1]?.createdAt, m.createdAt) && (
            <div className="divider">{formatDivider(m.createdAt)}</div>
          )}
          <article className={`message ${m.role}${m.card ? ' with-card' : ''}`}>
            {authorOf && m.agentGroupId && <Author member={authorOf(m.agentGroupId)} />}
            {m.card ? (
              <CardView message={{ ...m, card: m.card }} onAnswered={onAnswered} onError={onError} />
            ) : (
              m.text && (m.role === 'agent' ? <AgentText text={m.text} /> : <div className="bubble">{m.text}</div>)
            )}
            {m.files.map((f) => (
              <FilePreview key={f.id} file={f} />
            ))}
            {(m.editedAt || m.reactions.length > 0) && (
              <footer className="message-meta">
                {m.editedAt && '編集済み'}
                {m.reactions.length > 0 && <span className="reactions">{m.reactions.map(emoji).join(' ')}</span>}
              </footer>
            )}
          </article>
        </div>
      ))}
    </div>
  );
}

function AgentText({ text }: { text: string }) {
  const { links, rest } = connectLinksIn(text);
  return (
    <>
      {rest && <Markdown className="bubble" text={rest} />}
      {links.map((link) => (
        <AppConnectCard key={link.provider} link={link} />
      ))}
    </>
  );
}

function Author({ member }: { member: Member }) {
  return (
    <span className="message-author">
      <Avatar id={member.id} name={member.name} size="sm" />
      {member.name}
    </span>
  );
}

function Composer({
  send,
  onSent,
  onError,
  members,
}: {
  send: (text: string, uploads: Upload[]) => Promise<ChatMessage>;
  onSent: (message: ChatMessage) => void;
  onError: (message: string) => void;
  members?: Member[];
}) {
  const [text, setText] = useState('');
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [sending, setSending] = useState(false);
  const [caret, setCaret] = useState(0);
  const [picked, setPicked] = useState(0);
  const input = useRef<HTMLTextAreaElement>(null);
  const mention = members ? mentionAt(text, caret, members) : null;

  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (sending || (!text.trim() && uploads.length === 0)) return;
    setSending(true);
    try {
      onSent(await send(text, uploads));
      setText('');
      setUploads([]);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  function complete(member: Member) {
    if (!mention) return;
    const inserted = `@${member.name} `;
    const next = text.slice(0, mention.start) + inserted + text.slice(caret);
    const at = mention.start + inserted.length;
    setText(next);
    setCaret(at);
    requestAnimationFrame(() => input.current?.setSelectionRange(at, at));
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.nativeEvent.isComposing) return;
    if (mention && mention.candidates.length > 0) {
      const count = mention.candidates.length;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setPicked((i) => (i + (e.key === 'ArrowDown' ? 1 : count - 1)) % count);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        complete(mention.candidates[Math.min(picked, count - 1)]);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) void submit(e);
  }

  async function attach(list: FileList | null) {
    if (!list) return;
    try {
      const added = await Promise.all(Array.from(list).map(readUpload));
      setUploads((prev) => [...prev, ...added]);
    } catch (err) {
      onError((err as Error).message);
    }
  }

  const empty = !text.trim() && uploads.length === 0;

  return (
    <form className="composer" onSubmit={submit}>
      <div className="composer-box">
        {mention && mention.candidates.length > 0 && (
          <ul className="mention-list" role="listbox" aria-label="Mention する Agent">
            {mention.candidates.map((m, i) => (
              <li key={m.id} role="option" aria-selected={i === Math.min(picked, mention.candidates.length - 1)}>
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => complete(m)}>
                  <Avatar id={m.id} name={m.name} size="sm" />
                  {m.name}
                </button>
              </li>
            ))}
          </ul>
        )}
        {uploads.length > 0 && (
          <ul className="uploads">
            {uploads.map((u, i) => (
              <li key={`${u.name}-${i}`}>
                {u.name}
                <button
                  type="button"
                  aria-label={`${u.name} を外す`}
                  onClick={() => setUploads((prev) => prev.filter((_, j) => j !== i))}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="composer-row">
          <label className="icon-button attach" title="ファイルを添付">
            <PlusIcon />
            <input
              type="file"
              multiple
              hidden
              onChange={(e) => {
                void attach(e.target.files);
                e.target.value = '';
              }}
            />
          </label>
          <textarea
            ref={input}
            value={text}
            placeholder={
              members ? '@ で Agent を呼んで話しかけてください' : '回答を入力するか、別の話題について話してください'
            }
            rows={1}
            onChange={(e) => {
              setText(e.target.value);
              setCaret(e.target.selectionStart);
              setPicked(0);
            }}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
            onKeyDown={onKeyDown}
          />
          <button type="submit" className="send-button" aria-label="送信" disabled={sending || empty}>
            <ArrowUpIcon />
          </button>
        </div>
      </div>
    </form>
  );
}

/** The `@…` being typed right before the caret, and the participants whose names it starts. */
function mentionAt(text: string, caret: number, members: Member[]): { start: number; candidates: Member[] } | null {
  const typed = /@([^\s@]*)$/.exec(text.slice(0, caret));
  if (!typed) return null;
  const prefix = typed[1].toLowerCase();
  const candidates = members.filter((m) => m.name.toLowerCase().startsWith(prefix));
  return { start: typed.index, candidates };
}

const EMOJI: Record<string, string> = {
  thumbs_up: '👍',
  '+1': '👍',
  heart: '❤️',
  check: '✅',
  white_check_mark: '✅',
  eyes: '👀',
  tada: '🎉',
  x: '❌',
};

function emoji(name: string): string {
  return EMOJI[name] ?? `:${name}:`;
}
