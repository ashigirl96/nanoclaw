import { type ChatMessage } from './api';
import { CardView } from './Card';
import { useFormatTime } from './time';

interface Props {
  messages: ChatMessage[];
  onUpdated: (message: ChatMessage) => void;
  onError: (message: string) => void;
}

export function Inbox({ messages, onUpdated, onError }: Props) {
  const formatTime = useFormatTime();
  return (
    <section className="chat">
      <header className="chat-header">Inbox</header>
      <div className="messages">
        {messages.length === 0 && <div className="empty">承認を待つものはありません。</div>}
        {messages.map((m) => (
          <article key={m.id} className={`message ${m.role}`}>
            {m.card ? (
              <CardView message={{ ...m, card: m.card }} onAnswered={onUpdated} onError={onError} />
            ) : (
              m.text && <div className="message-text">{m.text}</div>
            )}
            <footer className="message-meta">{formatTime(m.createdAt)}</footer>
          </article>
        ))}
      </div>
    </section>
  );
}
