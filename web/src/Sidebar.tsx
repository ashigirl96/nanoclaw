import { useState } from 'react';

import type { AgentGroupSummary, ChatMessage, GroupChatSummary } from './api';
import { Avatar } from './Avatar';
import { GroupIcon, InboxIcon, LinkIcon, PlusIcon, SearchIcon } from './Icons';

interface Props {
  groups: AgentGroupSummary[];
  groupChats: GroupChatSummary[];
  /** The chat id of the open Chat. */
  selected: string | null;
  inboxSelected: boolean;
  inboxWaiting: number;
  accountsVisible: boolean;
  accountsSelected: boolean;
  onSelect: (id: string) => void;
  onSelectGroupChat: (id: string) => void;
  onSelectInbox: () => void;
  onSelectAccounts: () => void;
  onNewAgent: () => void;
  onNewGroupChat: () => void;
}

export function Sidebar({
  groups,
  groupChats,
  selected,
  inboxSelected,
  inboxWaiting,
  accountsVisible,
  accountsSelected,
  onSelect,
  onSelectGroupChat,
  onSelectInbox,
  onSelectAccounts,
  onNewAgent,
  onNewGroupChat,
}: Props) {
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const shown = needle ? groups.filter((g) => g.name.toLowerCase().includes(needle)) : groups;
  const shownChats = needle ? groupChats.filter((c) => c.name.toLowerCase().includes(needle)) : groupChats;
  const nameOf = (agentGroupId: string) => groups.find((g) => g.id === agentGroupId)?.name ?? agentGroupId;

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
              className={['group', g.chatId === selected && 'selected', g.unread > 0 && 'unread']
                .filter(Boolean)
                .join(' ')}
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
        {needle && shown.length === 0 && shownChats.length === 0 && <li className="sidebar-none">見つかりません</li>}
        <li className="sidebar-heading">
          <span>Group Chat</span>
          <button type="button" className="icon-button small" aria-label="Group Chat を作る" onClick={onNewGroupChat}>
            <PlusIcon size={14} />
          </button>
        </li>
        {shownChats.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              className={['group', c.chatId === selected && 'selected', c.unread > 0 && 'unread']
                .filter(Boolean)
                .join(' ')}
              onClick={() => onSelectGroupChat(c.id)}
            >
              <span className="avatar md inbox-avatar" aria-hidden="true">
                <GroupIcon />
                {Object.values(c.activity).some((a) => a.working) && (
                  <span className="working-dot" title="作業中" aria-label="作業中" />
                )}
              </span>
              <span className="group-text">
                <span className="group-name">{c.name}</span>
                <span className="group-excerpt">{excerpt(c.lastMessage, nameOf)}</span>
              </span>
              {c.unread > 0 && (
                <span className="unread-badge" aria-label={`未読 ${c.unread} 件`}>
                  {c.unread}
                </span>
              )}
            </button>
          </li>
        ))}
        {!needle && groupChats.length === 0 && <li className="sidebar-none">まだ Group Chat はありません</li>}
      </ul>
    </nav>
  );
}

function excerpt(message: ChatMessage | null, nameOf?: (agentGroupId: string) => string): string {
  if (!message) return 'まだメッセージはありません';
  const speaker = message.agentGroupId && nameOf ? `${nameOf(message.agentGroupId)}: ` : '';
  const prefix = message.role === 'owner' ? 'あなた: ' : speaker;
  const body = message.text.trim() || message.files.map((f) => f.name).join(', ');
  return prefix + body.replace(/\s+/g, ' ');
}
