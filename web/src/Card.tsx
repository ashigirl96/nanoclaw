import { useState } from 'react';

import { type Card, type ChatMessage, type ChoiceCard, type LinkCard, api } from './api';
import { FormCardView } from './FormCard';
import { Markdown } from './Markdown';

interface Props {
  message: ChatMessage & { card: Card };
  onAnswered: (message: ChatMessage) => void;
  onError: (message: string) => void;
}

export function CardView({ message, onAnswered, onError }: Props) {
  const { card } = message;
  if (card.type === 'links') return <LinkCardView card={card} />;
  if (card.type === 'form') {
    return <FormCardView messageId={message.id} card={card} onAnswered={onAnswered} onError={onError} />;
  }
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

  const asButtons = card.options.some((o) => o.style && o.style !== 'default');

  return (
    <div className={`card ${card.type}`}>
      {card.title && <div className="card-eyebrow">{card.title}</div>}
      {card.question && <Markdown className="card-question" text={card.question} />}
      {card.resolution !== null ? (
        <div className="card-resolution">{card.resolution}</div>
      ) : asButtons ? (
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
        <ol className="choices">
          {card.options.map((o, i) => (
            <li key={o.value}>
              <button type="button" className="choice" disabled={sending} onClick={() => void pick(o.value)}>
                <span className="choice-key">{String.fromCharCode(65 + (i % 26))}</span>
                <span className="choice-label">{o.label}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function LinkCardView({ card }: { card: LinkCard }) {
  return (
    <div className="card links">
      {card.title && <div className="card-question">{card.title}</div>}
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
