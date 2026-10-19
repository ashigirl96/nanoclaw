import { useState } from 'react';

import { type Card, type ChatMessage, type ChoiceCard, type LinkCard, api } from './api';

interface Props {
  message: ChatMessage & { card: Card };
  onAnswered: (message: ChatMessage) => void;
  onError: (message: string) => void;
}

export function CardView({ message, onAnswered, onError }: Props) {
  const { card } = message;
  if (card.type === 'links') return <LinkCardView card={card} />;
  return <ChoiceCardView messageId={message.id} card={card} onAnswered={onAnswered} onError={onError} />;
}

function ChoiceCardView({
  messageId,
  card,
  onAnswered,
  onError,
}: {
  messageId: string;
  card: ChoiceCard;
  onAnswered: (message: ChatMessage) => void;
  onError: (message: string) => void;
}) {
  const [sending, setSending] = useState(false);

  async function pick(value: string) {
    setSending(true);
    try {
      onAnswered(await api.answer(messageId, value));
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className={`card ${card.type}`}>
      {card.title && <div className="card-title">{card.title}</div>}
      {card.question && <div className="card-body">{card.question}</div>}
      {card.resolution === null ? (
        <div className="card-actions">
          {card.options.map((o) => (
            <button
              key={o.value}
              type="button"
              className={`card-button ${o.style ?? 'default'}`}
              disabled={sending}
              onClick={() => void pick(o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
      ) : (
        <div className="card-resolution">{card.resolution}</div>
      )}
    </div>
  );
}

function LinkCardView({ card }: { card: LinkCard }) {
  return (
    <div className="card links">
      {card.title && <div className="card-title">{card.title}</div>}
      {card.description && <div className="card-body">{card.description}</div>}
      {card.children.map((text, i) => (
        <div key={i} className="card-body">
          {text}
        </div>
      ))}
      {card.links.length > 0 && (
        <div className="card-actions">
          {card.links.map((l) => (
            <a
              key={l.url + l.label}
              className={`card-button ${l.style ?? 'default'}`}
              href={l.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {l.label}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
