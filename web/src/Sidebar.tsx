import { useState } from 'react';

import type { AgentGroupSummary, ChatMessage } from './api';
import { Avatar } from './Avatar';
import { InboxIcon, LinkIcon, PlusIcon, SearchIcon } from './Icons';

interface Props {
  groups: AgentGroupSummary[];
  selected: string | null;
  inboxSelected: boolean;
  inboxWaiting: number;
  accountsVisible: boolean;
  accountsSelected: boolean;
  onSelect: (id: string) => void;
  onSelectInbox: () => void;
  onSelectAccounts: () => void;
  onNewAgent: () => void;
}

export function Sidebar({
  groups,
  selected,
  inboxSelected,
  inboxWaiting,
  accountsVisible,
  accountsSelected,
  onSelect,
  onSelectInbox,
  onSelectAccounts,
  onNewAgent,
}: Props) {
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const shown = needle ? groups.filter((g) => g.name.toLowerCase().includes(needle)) : groups;

  return (
    <nav className="sidebar" aria-label="Agent">
      <div className="sidebar-top">
        <button
          type="button"
          className="icon-button"
          aria-label="Agent を検索"
          aria-pressed={searching}
          onClick={() => {
            setSearching((s) => !s);
            setQuery('');
          }}
        >
          <SearchIcon />
        </button>
        <button type="button" className="icon-button" aria-label="Agent を作る" onClick={onNewAgent}>
          <PlusIcon />
        </button>
      </div>
      {searching && (
        <input
          className="sidebar-search"
          type="search"
          placeholder="Agent を検索"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setSearching(false)}
        />
      )}
      <ul>
        {!needle && (
          <li>
            <button
              type="button"
              className={['group', inboxSelected && 'selected', inboxWaiting > 0 && 'unread'].filter(Boolean).join(' ')}
              onClick={onSelectInbox}
            >
              <span className="avatar md inbox-avatar" aria-hidden="true">
                <InboxIcon />
              </span>
              <span className="group-text">
                <span className="group-name">Inbox</span>
                <span className="group-excerpt">
                  {inboxWaiting > 0 ? `${inboxWaiting} 件の承認待ち` : '承認を待つものはありません'}
                </span>
              </span>
              {inboxWaiting > 0 && (
                <span className="unread-badge" aria-label={`承認待ち ${inboxWaiting} 件`}>
                  {inboxWaiting}
                </span>
              )}
            </button>
          </li>
        )}
        {!needle && accountsVisible && (
          <li>
            <button type="button" className={accountsSelected ? 'group selected' : 'group'} onClick={onSelectAccounts}>
              <span className="avatar md inbox-avatar" aria-hidden="true">
                <LinkIcon />
              </span>
              <span className="group-text">
                <span className="group-name">Connected Accounts</span>
                <span className="group-excerpt">OneCLI につないだアカウント</span>
              </span>
            </button>
          </li>
        )}
        {shown.map((g) => (
          <li key={g.id}>
            <button
              type="button"
              className={['group', g.id === selected && 'selected', g.unread > 0 && 'unread'].filter(Boolean).join(' ')}
              onClick={() => onSelect(g.id)}
            >
              <Avatar
                id={g.id}
                name={g.name}
                badge={g.activity.working && <span className="working-dot" title="作業中" aria-label="作業中" />}
              />
              <span className="group-text">
                <span className="group-name">{g.name}</span>
                <span className="group-excerpt">{excerpt(g.lastMessage)}</span>
              </span>
              {g.unread > 0 && (
                <span className="unread-badge" aria-label={`未読 ${g.unread} 件`}>
                  {g.unread}
                </span>
              )}
            </button>
          </li>
        ))}
        {needle && shown.length === 0 && <li className="sidebar-none">見つかりません</li>}
      </ul>
    </nav>
  );
}

function excerpt(message: ChatMessage | null): string {
  if (!message) return 'まだメッセージはありません';
  const prefix = message.role === 'owner' ? 'あなた: ' : '';
  const body = message.text.trim() || message.files.map((f) => f.name).join(', ');
  return prefix + body.replace(/\s+/g, ' ');
}
