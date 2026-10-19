import { type FormEvent, useEffect, useRef, useState } from 'react';

import { type Template, api } from './api';

interface Props {
  onCreated: (agentGroupId: string) => void;
  onClose: () => void;
}

export function NewAgentDialog({ onCreated, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [template, setTemplate] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: 'error' | 'held'; text: string } | null>(null);

  useEffect(() => {
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
    api.templates().then(
      (list) => {
        setTemplates(list);
        if (list[0]) setTemplate(list[0].ref);
      },
      (err: Error) => setStatus({ kind: 'error', text: err.message }),
    );
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !template || !name.trim()) return;
    setBusy(true);
    setStatus(null);
    try {
      const outcome = await api.createAgent(template, name.trim());
      if (outcome.status === 'created') {
        onCreated(outcome.agentGroup.id);
        return;
      }
      setStatus({ kind: 'held', text: 'Approver の承認を待っています。承認されるとサイドバーに出ます。' });
    } catch (err) {
      setStatus({ kind: 'error', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const selected = templates?.find((t) => t.ref === template);

  return (
    <dialog ref={dialog} className="new-agent" onClose={onClose}>
      <form onSubmit={submit}>
        <h2>Agent を作る</h2>
        {templates && templates.length === 0 ? (
          <p className="panel-note">
            この Install に Template がありません。<code>templates/</code> に置いてから開き直してください。
          </p>
        ) : (
          <>
            <label>
              Template
              <select value={template} onChange={(e) => setTemplate(e.target.value)} disabled={!templates}>
                {templates?.map((t) => (
                  <option key={t.ref} value={t.ref}>
                    {t.ref}
                  </option>
                ))}
              </select>
            </label>
            {selected?.description && <p className="panel-note">{selected.description}</p>}
            <label>
              名前
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例: リサーチ係" autoFocus />
            </label>
          </>
        )}
        {status && <p className={status.kind === 'error' ? 'dialog-error' : 'panel-note'}>{status.text}</p>}
        <div className="dialog-actions">
          <button type="button" onClick={() => dialog.current?.close()}>
            {status?.kind === 'held' ? '閉じる' : 'やめる'}
          </button>
          {status?.kind !== 'held' && (
            <button type="submit" className="primary" disabled={busy || !template || !name.trim()}>
              作る
            </button>
          )}
        </div>
      </form>
    </dialog>
  );
}
