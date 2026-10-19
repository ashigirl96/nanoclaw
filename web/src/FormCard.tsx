import { type FormEvent, useState } from 'react';

import { type ChatMessage, type FormCard, type FormField, type FormValues, api } from './api';

interface Props {
  messageId: string;
  card: FormCard;
  onAnswered: (message: ChatMessage) => void;
  onError: (message: string) => void;
}

export function FormCardView({ messageId, card, onAnswered, onError }: Props) {
  const [values, setValues] = useState<FormValues>({});
  const [sending, setSending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSending(true);
    try {
      onAnswered(await api.answerForm(messageId, values));
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  const set = (id: string, value: string | string[]) => setValues((v) => ({ ...v, [id]: value }));

  return (
    <div className="card form">
      {card.title && <div className="card-title">{card.title}</div>}
      {card.question && <div className="card-body">{card.question}</div>}
      {card.resolution === null ? (
        <form className="card-form" onSubmit={(e) => void submit(e)}>
          {card.fields.map((field) => {
            const inputId = `${messageId}-${field.id}`;
            return (
              <div key={field.id} className="card-field">
                {field.type === 'multi_select' ? (
                  <span className="card-field-label">{field.label}</span>
                ) : (
                  <label className="card-field-label" htmlFor={inputId}>
                    {field.label}
                  </label>
                )}
                <FieldInput
                  id={inputId}
                  field={field}
                  value={values[field.id]}
                  disabled={sending}
                  onChange={(v) => set(field.id, v)}
                />
              </div>
            );
          })}
          <div className="card-actions">
            <button type="submit" className="card-button primary" disabled={sending}>
              送信
            </button>
          </div>
        </form>
      ) : (
        <div className="card-resolution">{card.resolution}</div>
      )}
    </div>
  );
}

function FieldInput({
  id,
  field,
  value,
  disabled,
  onChange,
}: {
  id: string;
  field: FormField;
  value: string | string[] | undefined;
  disabled: boolean;
  onChange: (value: string | string[]) => void;
}) {
  if (field.type === 'multi_select') {
    const picked = Array.isArray(value) ? value : [];
    return (
      <span className="card-checks">
        {field.options?.map((o) => (
          <label key={o} className="card-check">
            <input
              type="checkbox"
              checked={picked.includes(o)}
              disabled={disabled}
              onChange={(e) => onChange(e.target.checked ? [...picked, o] : picked.filter((p) => p !== o))}
            />
            {o}
          </label>
        ))}
      </span>
    );
  }
  const text = typeof value === 'string' ? value : '';
  if (field.type === 'select') {
    return (
      <select id={id} value={text} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {field.options?.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  if (field.type === 'textarea') {
    return <textarea id={id} rows={3} value={text} disabled={disabled} onChange={(e) => onChange(e.target.value)} />;
  }
  return (
    <input
      id={id}
      type={field.type === 'date' ? 'date' : 'text'}
      value={text}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
