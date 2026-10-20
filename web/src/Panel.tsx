import { type FormEvent, useEffect, useRef, useState } from 'react';

import {
  type AgentGroupDetails,
  type AgentGroupSummary,
  type LibraryFile,
  type TaskSummary,
  api,
  readUpload,
} from './api';
import { Avatar } from './Avatar';
import { FilePreview } from './FilePreview';
import { CloseIcon } from './Icons';
import { useFormatTime } from './time';
import './panel.css';

type Tab = 'details' | 'library' | 'tasks';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'details', label: '詳細' },
  { id: 'library', label: 'ライブラリ' },
  { id: 'tasks', label: 'Task' },
];

interface Props {
  group: AgentGroupSummary;
  /** Changes whenever the Chat gains a message, so the Library picks up new files. */
  revision: number;
  onClose: () => void;
  onError: (message: string) => void;
}

export function Panel({ group, revision, onClose, onError }: Props) {
  const [tab, setTab] = useState<Tab>('library');
  const agentGroupId = group.id;
  return (
    <aside className="panel" aria-label="Agent の情報">
      <div className="panel-top">
        <button type="button" className="icon-button" aria-label="パネルを閉じる" onClick={onClose}>
          <CloseIcon />
        </button>
      </div>
      <div className="panel-profile">
        <Avatar id={group.id} name={group.name} url={group.avatarUrl} size="lg" />
        <div className="panel-name">{group.name}</div>
      </div>
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? 'tab selected' : 'tab'}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="panel-body" role="tabpanel">
        {tab === 'details' && <Details group={group} onError={onError} />}
        {tab === 'library' && <Library agentGroupId={agentGroupId} revision={revision} onError={onError} />}
        {tab === 'tasks' && <Tasks agentGroupId={agentGroupId} onError={onError} />}
      </div>
    </aside>
  );
}

function useLoad<T>(load: () => Promise<T>, deps: unknown[], onError: (message: string) => void): T | null {
  const [value, setValue] = useState<T | null>(null);
  useEffect(() => {
    let cancelled = false;
    load().then(
      (v) => !cancelled && setValue(v),
      (err: Error) => !cancelled && onError(err.message),
    );
    return () => {
      cancelled = true;
    };
  }, deps);
  return value;
}

function Details({ group, onError }: { group: AgentGroupSummary; onError: (m: string) => void }) {
  // The summary changes when the Label or Avatar does, so the details follow edits from any Console.
  const details = useLoad<AgentGroupDetails>(
    () => api.details(group.id),
    [group.id, group.label, group.avatarUrl],
    onError,
  );
  const formatTime = useFormatTime();
  if (!details) return <p className="panel-note">読み込み中…</p>;
  return (
    <dl className="details">
      <dt>名前</dt>
      <dd>{details.name}</dd>
      <dt>ラベル</dt>
      <dd>
        <LabelField key={details.label ?? ''} agentGroupId={details.id} label={details.label} onError={onError} />
      </dd>
      <dt>アバター</dt>
      <dd>
        <AvatarField details={details} onError={onError} />
      </dd>
      <dt>ID</dt>
      <dd>
        <code>{details.id}</code>
      </dd>
      <dt>フォルダ</dt>
      <dd>
        <code>groups/{details.folder}</code>
      </dd>
      <dt>作成</dt>
      <dd>{formatTime(details.createdAt)}</dd>
    </dl>
  );
}

function LabelField({
  agentGroupId,
  label,
  onError,
}: {
  agentGroupId: string;
  label: string | null;
  onError: (m: string) => void;
}) {
  const [draft, setDraft] = useState(label ?? '');
  const [saving, setSaving] = useState(false);
  const changed = draft.trim() !== (label ?? '');

  const save = (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    api
      .setLabel(agentGroupId, draft)
      .catch((err: Error) => onError(err.message))
      .finally(() => setSaving(false));
  };

  return (
    <form className="label-field" onSubmit={save}>
      <input
        type="text"
        value={draft}
        placeholder="役割を 40 字まで"
        aria-label="ラベル"
        onChange={(e) => setDraft(e.target.value)}
      />
      {changed && (
        <button type="submit" className="card-button" disabled={saving}>
          保存
        </button>
      )}
    </form>
  );
}

function AvatarField({ details, onError }: { details: AgentGroupDetails; onError: (m: string) => void }) {
  const picker = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const run = (action: () => Promise<unknown>) => {
    setBusy(true);
    action()
      .catch((err: Error) => onError(err.message))
      .finally(() => setBusy(false));
  };

  return (
    <div className="avatar-field">
      <input
        ref={picker}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) run(async () => api.uploadAvatar(details.id, await readUpload(file)));
        }}
      />
      <button type="button" className="card-button" disabled={busy} onClick={() => picker.current?.click()}>
        画像を選ぶ
      </button>
      {details.avatarSource === 'upload' && (
        <button
          type="button"
          className="card-button"
          disabled={busy}
          onClick={() => run(() => api.removeAvatar(details.id))}
        >
          画像を外す
        </button>
      )}
      {details.ownSlackBot && (
        <button
          type="button"
          className="card-button"
          disabled={busy}
          onClick={() => run(() => api.refetchSlackAvatar(details.id))}
        >
          Slack から取り直す
        </button>
      )}
      <span className="panel-hint">PNG、JPEG、WebP、GIF で 1 MB まで</span>
    </div>
  );
}

function Library({
  agentGroupId,
  revision,
  onError,
}: {
  agentGroupId: string;
  revision: number;
  onError: (m: string) => void;
}) {
  const files = useLoad<LibraryFile[]>(() => api.library(agentGroupId), [agentGroupId, revision], onError);
  const [open, setOpen] = useState<string | null>(null);
  const formatTime = useFormatTime();
  if (!files) return <p className="panel-note">読み込み中…</p>;
  if (files.length === 0) return <p className="panel-note">この Agent が届けたファイルがここに表示されます</p>;
  return (
    <ul className="library">
      {files.map((f) => (
        <li key={f.id}>
          <button type="button" className="library-item" onClick={() => setOpen(open === f.id ? null : f.id)}>
            <span className="library-name">{f.name}</span>
            <span className="library-date">{formatTime(f.createdAt)}</span>
          </button>
          {open === f.id && <FilePreview file={f} />}
        </li>
      ))}
    </ul>
  );
}

function Tasks({ agentGroupId, onError }: { agentGroupId: string; onError: (m: string) => void }) {
  const tasks = useLoad<TaskSummary[]>(() => api.tasks(agentGroupId), [agentGroupId], onError);
  const formatTime = useFormatTime();
  if (!tasks) return <p className="panel-note">読み込み中…</p>;
  if (tasks.length === 0) return <p className="panel-note">この Agent の Task はありません。</p>;
  return (
    <ul className="tasks">
      {tasks.map((t) => (
        <li key={t.taskId} className="task">
          <div className="task-prompt">{t.prompt}</div>
          <dl className="task-facts">
            <dt>予定</dt>
            <dd>
              <code>{t.schedule === 'once' ? '1 回だけ' : t.schedule}</code>
              {t.status === 'paused' && <span className="badge">停止中</span>}
            </dd>
            <dt>次回</dt>
            <dd>{t.nextOccurrence ? formatTime(t.nextOccurrence) : '—'}</dd>
            <dt>最後</dt>
            <dd>
              {t.lastOccurrence ? formatTime(t.lastOccurrence) : 'まだ動いていません'}
              {t.occurrences > 0 && `（${t.occurrences} 回）`}
              {t.failedOccurrences > 0 && <span className="badge danger">失敗 {t.failedOccurrences}</span>}
            </dd>
            {t.lastResult && (
              <>
                <dt>結果</dt>
                <dd className="task-result">{t.lastResult}</dd>
              </>
            )}
          </dl>
        </li>
      ))}
    </ul>
  );
}
