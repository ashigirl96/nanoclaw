import { type ChatMessage } from './api';
import { Thread } from './Chat';
import { InboxIcon } from './Icons';

interface Props {
  messages: ChatMessage[];
  onUpdated: (message: ChatMessage) => void;
  onError: (message: string) => void;
}

export function Inbox({ messages, onUpdated, onError }: Props) {
  return (
    <section className="chat">
      <div className="chat-scroll">
        <div className="chat-title">
          <span className="chat-pill">
            <span className="avatar sm inbox-avatar" aria-hidden="true">
              <InboxIcon />
            </span>
            Inbox
          </span>
        </div>
        {messages.length === 0 ? (
          <div className="empty">承認を待つものはありません。</div>
        ) : (
          <Thread messages={messages} onAnswered={onUpdated} onError={onError} />
        )}
      </div>
    </section>
  );
}
