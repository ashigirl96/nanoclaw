import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';

import { type AgentGroupSummary, type GroupChatSummary, api } from './api';
import { Avatar } from './Avatar';

const MIN_MEMBERS = 2;

function Dialog({ onClose, children }: { onClose: () => void; children: (close: () => void) => ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
  }, []);
  return (
    <dialog ref={dialog} className="new-agent" onClose={onClose}>
      {children(() => dialog.current?.close())}
    </dialog>
  );
}

export function NewGroupChatDialog({
  groups,
  onCreated,
  onClose,
}: {
  groups: AgentGroupSummary[];
  onCreated: (groupChatId: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = name.trim() !== '' && chosen.length >= MIN_MEMBERS;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !ready) return;
    setBusy(true);
    setError(null);
    try {
      onCreated((await api.createGroupChat(name.trim(), chosen)).id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog onClose={onClose}>
      {(close) => (
        <form onSubmit={submit}>
          <h2>Group Chat を作る</h2>
          <label>
            名前
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例: 企画会議" autoFocus />
          </label>
          <fieldset className="member-picker">
            <legend>参加する Agent（{MIN_MEMBERS} つ以上）</legend>
            {groups.map((g) => (
              <label key={g.id} className="member-option">
                <input
                  type="checkbox"
                  checked={chosen.includes(g.id)}
                  onChange={(e) =>
                    setChosen((prev) => (e.target.checked ? [...prev, g.id] : prev.filter((id) => id !== g.id)))
                  }
                />
                <Avatar id={g.id} name={g.name} size="sm" />
                {g.name}
              </label>
            ))}
          </fieldset>
          {error && <p className="dialog-error">{error}</p>}
          <div className="dialog-actions">
            <button type="button" onClick={close}>
              やめる
            </button>
            <button type="submit" className="primary" disabled={busy || !ready}>
              作る
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

export function GroupChatSettingsDialog({
  chat,
  groups,
  onChanged,
  onDeleted,
  onClose,
}: {
  chat: GroupChatSummary;
  groups: AgentGroupSummary[];
  onChanged: (chat: GroupChatSummary) => void;
  onDeleted: () => void;
  onClose: () => void;
}) {
  const [adding, setAdding] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const outside = groups.filter((g) => !chat.members.some((m) => m.id === g.id));

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog onClose={onClose}>
      {(close) =>
        confirming ? (
          <div>
            <h2>「{chat.name}」を消しますか？</h2>
            <p className="panel-note">
              参加している Agent はこの Group Chat で起きなくなり、ここでの会話の続きも失われます。Console
              の履歴は消えません。
            </p>
            {error && <p className="dialog-error">{error}</p>}
            <div className="dialog-actions">
              <button type="button" onClick={() => setConfirming(false)}>
                やめる
              </button>
              <button
                type="button"
                className="danger"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await api.deleteGroupChat(chat.id);
                    onDeleted();
                  })
                }
              >
                消す
              </button>
            </div>
          </div>
        ) : (
          <div>
            <h2>{chat.name}</h2>
            <ul className="member-list">
              {chat.members.map((m) => (
                <li key={m.id}>
                  <Avatar id={m.id} name={m.name} size="sm" />
                  <span className="member-name">{m.name}</span>
                  <button
                    type="button"
                    aria-label={`${m.name} を外す`}
                    disabled={busy || chat.members.length <= MIN_MEMBERS}
                    onClick={() => void run(async () => onChanged(await api.removeMember(chat.id, m.id)))}
                  >
                    外す
                  </button>
                </li>
              ))}
            </ul>
            {outside.length > 0 && (
              <form
                className="member-add"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!adding) return;
                  void run(async () => {
                    onChanged(await api.addMember(chat.id, adding));
                    setAdding('');
                  });
                }}
              >
                <select value={adding} onChange={(e) => setAdding(e.target.value)}>
                  <option value="">Agent を足す…</option>
                  {outside.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
                <button type="submit" disabled={busy || !adding}>
                  足す
                </button>
              </form>
            )}
            {error && <p className="dialog-error">{error}</p>}
            <div className="dialog-actions">
              <button type="button" className="danger" onClick={() => setConfirming(true)}>
                Group Chat を消す
              </button>
              <button type="button" onClick={close}>
                閉じる
              </button>
            </div>
          </div>
        )
      }
    </Dialog>
  );
}
