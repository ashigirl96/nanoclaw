import { useEffect, useRef, useState } from 'react';

import { type ConnectedApp } from './api';
import { CATEGORIES, type Category, type ConnectLink, isConnected, lookOf, useConnectedApps } from './apps';
import { CloseIcon, SearchIcon } from './Icons';
import { useFormatTime } from './time';

export function AppIcon({ provider, name, size = 'md' }: { provider: string; name: string; size?: 'sm' | 'md' }) {
  const { icon, color } = lookOf(provider);
  if (icon) {
    return (
      <span className={`app-icon ${size} logo`} aria-hidden="true">
        <svg viewBox="0 0 24 24" fill={`#${icon.hex}`}>
          <path d={icon.path} />
        </svg>
      </span>
    );
  }
  return (
    <span className={`app-icon ${size}`} style={{ background: color }} aria-hidden="true">
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function AppIconStack({ apps, max }: { apps: ConnectedApp[]; max: number }) {
  return (
    <span className="app-icon-stack">
      {apps.slice(0, max).map((app) => (
        <AppIcon key={app.provider} provider={app.provider} name={app.name} size="sm" />
      ))}
    </span>
  );
}

function ConnectLinkButton({ url, label, primary }: { url: string; label: string; primary?: boolean }) {
  return (
    <a
      className={`card-button ${primary ? 'primary' : 'default'}`}
      href={url}
      target="_blank"
      rel="noopener noreferrer"
    >
      {label}
    </a>
  );
}

export function ConnectAppsButton({ onClick }: { onClick: () => void }) {
  const connected = useConnectedApps()?.filter(isConnected) ?? [];
  return (
    <button type="button" className="connect-apps-button" onClick={onClick}>
      アプリを接続
      {connected.length > 0 && <AppIconStack apps={connected} max={3} />}
    </button>
  );
}

export function AppConnectCard({ link }: { link: ConnectLink }) {
  const app = useConnectedApps()?.find((a) => a.provider === link.provider);
  const name = app?.name ?? link.provider;
  return (
    <div className="card app-connect">
      <div className="app-connect-main">
        <AppIcon provider={link.provider} name={name} />
        <span className="app-connect-text">
          <span className="app-connect-name">{name}</span>
          <span className="app-connect-note">この Agent が {name} を使えるようにします</span>
        </span>
        {/* The Agent's own link, since OneCLI grants the app to the Agent named in it. */}
        <ConnectLinkButton url={link.url} label={app && isConnected(app) ? 'つなぎ直す' : '接続'} />
      </div>
      <div className="app-connect-foot">接続は OneCLI の dashboard でいつでも解除できます。</div>
    </div>
  );
}

type Filter = 'すべて' | Category;

export function ConnectAppsDialog({ error, onClose }: { error: string | null; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const apps = useConnectedApps();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('すべて');
  const [connectedPicked, setConnectedPicked] = useState(false);

  useEffect(() => {
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
  }, []);

  const connected = apps?.filter(isConnected) ?? [];
  // The last account can go while this view is open, and the toggle back lives on the count.
  const showConnected = connectedPicked && connected.length > 0;
  const needle = query.trim().toLowerCase();
  const matches = (apps ?? []).filter(
    (a) => !needle || a.name.toLowerCase().includes(needle) || a.provider.includes(needle),
  );
  const sections = (filter === 'すべて' ? CATEGORIES : [filter])
    .map((category) => ({ category, apps: matches.filter((a) => lookOf(a.provider).category === category) }))
    .filter((s) => s.apps.length > 0);

  return (
    <dialog
      ref={dialog}
      className="connect-apps"
      onClose={onClose}
      onClick={(e) => e.target === dialog.current && dialog.current.close()}
    >
      <div className="connect-apps-head">
        <div className="connect-apps-top">
          {connected.length > 0 && (
            <button
              type="button"
              className="connect-apps-connected"
              aria-pressed={showConnected}
              onClick={() => setConnectedPicked((s) => !s)}
            >
              <AppIconStack apps={connected} max={4} />
              {connected.length}件接続済み {showConnected ? '‹' : '›'}
            </button>
          )}
          <button type="button" className="icon-button" aria-label="閉じる" onClick={() => dialog.current?.close()}>
            <CloseIcon />
          </button>
        </div>
        {error && (
          <div className="accounts-error" role="alert">
            OneCLI から一覧を読めませんでした（{error}）。OneCLI が動いているか確かめてください。
          </div>
        )}
        {!showConnected && (
          <>
            <label className="connect-apps-search">
              <SearchIcon />
              <input
                type="search"
                placeholder="アプリを検索"
                value={query}
                autoFocus
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <div className="connect-apps-filters" role="group" aria-label="カテゴリ">
              {(['すべて', ...CATEGORIES] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  className="connect-apps-chip"
                  aria-pressed={filter === c}
                  onClick={() => setFilter(c)}
                >
                  {c}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      <div className="connect-apps-body">
        {showConnected ? (
          <ul className="accounts-list">
            {connected.map((app) => (
              <ConnectedRow key={app.provider} app={app} />
            ))}
          </ul>
        ) : (
          <>
            {apps === null && !error && <div className="empty">読み込み中…</div>}
            {apps !== null && sections.length === 0 && <p className="accounts-none">見つかりません</p>}
            {sections.map((s) => (
              <section key={s.category} className="connect-apps-section">
                <h2 className="connect-apps-heading">{s.category}</h2>
                <ul className="connect-apps-grid">
                  {s.apps.map((app) => (
                    <li key={app.provider} className="connect-apps-item">
                      <AppIcon provider={app.provider} name={app.name} />
                      <span className="connect-apps-name">{app.name}</span>
                      {isConnected(app) ? (
                        <span className="connect-apps-done">接続済み</span>
                      ) : (
                        <ConnectLinkButton url={app.connectUrl} label="接続" />
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </>
        )}
      </div>
    </dialog>
  );
}

function ConnectedRow({ app }: { app: ConnectedApp }) {
  const formatTime = useFormatTime();
  // An expired grant stays in OneCLI as an account, so the app would otherwise offer no way back.
  const needsReconnect = app.accounts.some((a) => a.status !== 'connected');
  return (
    <li className="accounts-row">
      <AppIcon provider={app.provider} name={app.name} />
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
      {needsReconnect && <ConnectLinkButton url={app.connectUrl} label="つなぎ直す" primary />}
    </li>
  );
}
