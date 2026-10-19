import { useEffect, useState } from 'react';

import { type AgentGroupDetails, type LibraryFile, type TaskSummary, api } from './api';
import { FilePreview } from './FilePreview';
import './panel.css';

type Tab = 'details' | 'library' | 'tasks';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'details', label: '詳細' },
  { id: 'library', label: 'Library' },
  { id: 'tasks', label: 'Task' },
];

interface Props {
  agentGroupId: string;
  /** Changes whenever the Chat gains a message, so the Library picks up new files. */
  revision: number;
  onError: (message: string) => void;
}

export function Panel({ agentGroupId, revision, onError }: Props) {
  const [tab, setTab] = useState<Tab>('details');
  return (
    <aside className="panel" aria-label="Agent の情報">
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
        {tab === 'details' && <Details agentGroupId={agentGroupId} onError={onError} />}
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

function Details({ agentGroupId, onError }: { agentGroupId: string; onError: (m: string) => void }) {
  const details = useLoad<AgentGroupDetails>(() => api.details(agentGroupId), [agentGroupId], onError);
  if (!details) return <p className="panel-note">読み込み中…</p>;
  return (
    <dl className="details">
      <dt>名前</dt>
      <dd>{details.name}</dd>
      <dt>ID</dt>
      <dd>
        <code>{details.id}</code>
      </dd>
      <dt>フォルダ</dt>
      <dd>
        <code>groups/{details.folder}</code>
      </dd>
      <dt>作成</dt>
      <dd>{new Date(details.createdAt).toLocaleString()}</dd>
    </dl>
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
  if (!files) return <p className="panel-note">読み込み中…</p>;
  if (files.length === 0) return <p className="panel-note">この Agent が届けたファイルはまだありません。</p>;
  return (
    <ul className="library">
      {files.map((f) => (
        <li key={f.id}>
          <button type="button" className="library-item" onClick={() => setOpen(open === f.id ? null : f.id)}>
            <span className="library-name">{f.name}</span>
            <span className="library-date">{new Date(f.createdAt).toLocaleString()}</span>
          </button>
          {open === f.id && <FilePreview file={f} />}
        </li>
      ))}
    </ul>
  );
}

function Tasks({ agentGroupId, onError }: { agentGroupId: string; onError: (m: string) => void }) {
  const tasks = useLoad<TaskSummary[]>(() => api.tasks(agentGroupId), [agentGroupId], onError);
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
            <dd>{t.nextOccurrence ? new Date(t.nextOccurrence).toLocaleString() : '—'}</dd>
            <dt>最後</dt>
            <dd>
              {t.lastOccurrence ? new Date(t.lastOccurrence).toLocaleString() : 'まだ動いていません'}
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
