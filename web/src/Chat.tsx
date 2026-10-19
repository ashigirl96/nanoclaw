import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react';

import { type AgentGroupSummary, type ChatMessage, type Upload, api, readUpload } from './api';
import { CardView } from './Card';
import { FilePreview } from './FilePreview';
import { useFormatTime } from './time';

interface Props {
  group: AgentGroupSummary;
  messages: ChatMessage[];
  onSent: (message: ChatMessage) => void;
  onError: (message: string) => void;
}

export function Chat({ group, messages, onSent, onError }: Props) {
  const [text, setText] = useState('');
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [sending, setSending] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const formatTime = useFormatTime();

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, group.activity.working]);

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

  return (
    <section className="chat">
      <header className="chat-header">{group.name}</header>
      <div className="messages">
        {messages.map((m) => (
          <article key={m.id} className={`message ${m.role}`}>
            {m.card ? (
              <CardView message={{ ...m, card: m.card }} onAnswered={onSent} onError={onError} />
            ) : (
              m.text && <div className="message-text">{m.text}</div>
            )}
            {m.files.map((f) => (
              <FilePreview key={f.id} file={f} />
            ))}
            <footer className="message-meta">
              {formatTime(m.createdAt)}
              {m.editedAt && ' (編集済み)'}
              {m.reactions.length > 0 && <span className="reactions">{m.reactions.map(emoji).join(' ')}</span>}
            </footer>
          </article>
        ))}
        {group.activity.working && (
          <div className="working" role="status">
            <span className="working-dot" />
            {group.activity.tool ? `${group.activity.tool} を実行中…` : '作業中…'}
          </div>
        )}
        <div ref={bottom} />
      </div>
      <form className="composer" onSubmit={submit}>
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
          <label className="attach" title="ファイルを添付">
            📎
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
            value={text}
            placeholder={`${group.name} にメッセージを送る`}
            rows={2}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <button type="submit" disabled={sending}>
            送信
          </button>
        </div>
      </form>
    </section>
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
