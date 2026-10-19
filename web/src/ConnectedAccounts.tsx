import { useCallback, useEffect, useState } from 'react';

import { type ConnectedApp, api } from './api';
import { LinkIcon } from './Icons';
import { isForeground, useForeground } from './notifications';
import { useFormatTime } from './time';

export function ConnectedAccounts() {
  const [apps, setApps] = useState<ConnectedApp[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.connectedAccounts().then(
      (body) => {
        setApps(body.apps);
        setError(null);
      },
      (err: Error) => setError(err.message),
    );
  }, []);
  useEffect(load, [load]);
  // The Owner connects an app on the OneCLI dashboard in another tab, then comes back here.
  useForeground(
    useCallback(() => {
      if (isForeground()) load();
    }, [load]),
  );

  const connected = apps?.filter((a) => a.accounts.length > 0) ?? [];
  const unconnected = apps?.filter((a) => a.accounts.length === 0) ?? [];

  return (
    <section className="chat">
      <div className="chat-scroll">
        <div className="chat-title">
          <span className="chat-pill">
            <span className="avatar sm inbox-avatar" aria-hidden="true">
              <LinkIcon />
            </span>
            Connected Accounts
          </span>
        </div>
        <div className="accounts">
          {error && (
            <div className="accounts-error" role="alert">
              OneCLI から一覧を読めませんでした（{error}）。OneCLI が動いているか確かめてください。
            </div>
          )}
          {apps === null ? (
            !error && <div className="empty">読み込み中…</div>
          ) : (
            <>
              <h2 className="accounts-heading">接続済み</h2>
              {connected.length === 0 ? (
                <p className="accounts-none">まだ接続した app はありません。</p>
              ) : (
                <ul className="accounts-list">
                  {connected.map((app) => (
                    <ConnectedRow key={app.provider} app={app} />
                  ))}
                </ul>
              )}
              <h2 className="accounts-heading">未接続</h2>
              {unconnected.length === 0 ? (
                <p className="accounts-none">すべての app を接続済みです。</p>
              ) : (
                <ul className="accounts-list">
                  {unconnected.map((app) => (
                    <li key={app.provider} className="accounts-row">
                      <span className="accounts-name">{app.name}</span>
                      <a
                        className="card-button primary"
                        href={app.connectUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        接続
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function ConnectedRow({ app }: { app: ConnectedApp }) {
  const formatTime = useFormatTime();
  // An expired grant stays in OneCLI as an account, so the app would otherwise offer no way back.
  const needsReconnect = app.accounts.some((a) => a.status !== 'connected');
  return (
    <li className="accounts-row">
      <span className="accounts-name">{app.name}</span>
      <ul className="accounts-accounts">
        {app.accounts.map((account, i) => (
          <li key={i}>
            <span>{account.label || '(label なし)'}</span>
            <span className={account.status === 'connected' ? 'accounts-status' : 'accounts-status warn'}>
              {account.status}
            </span>
            {account.connectedAt && <span className="accounts-time">{formatTime(account.connectedAt)}</span>}
          </li>
        ))}
      </ul>
      {needsReconnect && (
        <a className="card-button primary" href={app.connectUrl} target="_blank" rel="noopener noreferrer">
          つなぎ直す
        </a>
      )}
    </li>
  );
}
