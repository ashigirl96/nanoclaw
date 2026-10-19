import { useEffect, useState } from 'react';

import { type AgentGroupDetails, type LibraryFile, type Routine, api } from './api';
import { FilePreview } from './FilePreview';
import './panel.css';

type Tab = 'details' | 'library' | 'routines';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'details', label: '詳細' },
  { id: 'library', label: 'Library' },
  { id: 'routines', label: 'Routine' },
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
        {tab === 'routines' && <Routines agentGroupId={agentGroupId} onError={onError} />}
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

function Routines({ agentGroupId, onError }: { agentGroupId: string; onError: (m: string) => void }) {
  const routines = useLoad<Routine[]>(() => api.routines(agentGroupId), [agentGroupId], onError);
  if (!routines) return <p className="panel-note">読み込み中…</p>;
  if (routines.length === 0) return <p className="panel-note">この Agent の Task はありません。</p>;
  return (
    <ul className="routines">
      {routines.map((r) => (
        <li key={r.seriesId} className="routine">
          <div className="routine-prompt">{r.prompt}</div>
          <dl className="routine-facts">
            <dt>予定</dt>
            <dd>
              <code>{r.schedule === 'once' ? '1 回だけ' : r.schedule}</code>
              {r.status === 'paused' && <span className="badge">停止中</span>}
            </dd>
            <dt>次回</dt>
            <dd>{r.nextRun ? new Date(r.nextRun).toLocaleString() : '—'}</dd>
            <dt>最後</dt>
            <dd>
              {r.lastRun ? new Date(r.lastRun).toLocaleString() : 'まだ動いていません'}
              {r.runs > 0 && `（${r.runs} 回）`}
              {r.failedRuns > 0 && <span className="badge danger">失敗 {r.failedRuns}</span>}
            </dd>
            {r.lastResult && (
              <>
                <dt>結果</dt>
                <dd className="routine-result">{r.lastResult}</dd>
              </>
            )}
          </dl>
        </li>
      ))}
    </ul>
  );
}
