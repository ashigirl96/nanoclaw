import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { type AgentGroupSummary, type ChatMessage, type Upload, api, readUpload } from './api';
import { Avatar } from './Avatar';
import { CardView } from './Card';
import { FilePreview } from './FilePreview';
import { ArrowUpIcon, PlusIcon } from './Icons';
import { Markdown } from './Markdown';
import { startsNewStretch, useFormatDivider } from './time';

interface Props {
  group: AgentGroupSummary;
  messages: ChatMessage[];
  onSent: (message: ChatMessage) => void;
  onError: (message: string) => void;
  panelOpen: boolean;
  onTogglePanel: () => void;
  headerAction?: ReactNode;
}

export function Chat({ group, messages, onSent, onError, panelOpen, onTogglePanel, headerAction }: Props) {
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, group.activity.working]);

  return (
    <section className="chat">
      <div className="chat-scroll">
        <div className="chat-title">
          <button type="button" className="chat-pill" aria-expanded={panelOpen} onClick={onTogglePanel}>
            <Avatar id={group.id} name={group.name} size="sm" />
            {group.name}
          </button>
          {headerAction}
        </div>
        <Thread messages={messages} onAnswered={onSent} onError={onError} />
        {group.activity.working && (
          <div className="thread">
            <div className="working" role="status">
              <span className="working-dot" />
              {group.activity.tool ? `${group.activity.tool} を実行中…` : '作業中…'}
            </div>
          </div>
        )}
        <div ref={bottom} />
      </div>
      <Composer group={group} onSent={onSent} onError={onError} />
    </section>
  );
}

export function Thread({
  messages,
  onAnswered,
  onError,
}: {
  messages: ChatMessage[];
  onAnswered: (message: ChatMessage) => void;
  onError: (message: string) => void;
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
            {m.card ? (
              <CardView message={{ ...m, card: m.card }} onAnswered={onAnswered} onError={onError} />
            ) : (
              m.text &&
              (m.role === 'agent' ? (
                <Markdown className="bubble" text={m.text} />
              ) : (
                <div className="bubble">{m.text}</div>
              ))
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

function Composer({
  group,
  onSent,
  onError,
}: {
  group: AgentGroupSummary;
  onSent: (message: ChatMessage) => void;
  onError: (message: string) => void;
}) {
  const [text, setText] = useState('');
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [sending, setSending] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);

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
      onSent(await api.send(group.id, text, uploads));
      setText('');
      setUploads([]);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) void submit(e);
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
            placeholder="回答を入力するか、別の話題について話してください"
            rows={1}
            onChange={(e) => setText(e.target.value)}
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
