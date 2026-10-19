import type { AgentGroupSummary, ChatMessage } from './api';

interface Props {
  groups: AgentGroupSummary[];
  selected: string | null;
  inboxSelected: boolean;
  inboxWaiting: number;
  onSelect: (id: string) => void;
  onSelectInbox: () => void;
}

export function Sidebar({ groups, selected, inboxSelected, inboxWaiting, onSelect, onSelectInbox }: Props) {
  return (
    <nav className="sidebar" aria-label="Agent">
      <div className="sidebar-title">Console</div>
      <ul>
        <li>
          <button type="button" className={inboxSelected ? 'group selected' : 'group'} onClick={onSelectInbox}>
            <span className="group-name">
              Inbox
              {inboxWaiting > 0 && <span className="badge">{inboxWaiting}</span>}
            </span>
            <span className="group-excerpt">
              {inboxWaiting > 0 ? `${inboxWaiting} 件の承認待ち` : '承認を待つものはありません'}
            </span>
          </button>
        </li>
        {groups.map((g) => (
          <li key={g.id}>
            <button
              type="button"
              className={g.id === selected ? 'group selected' : 'group'}
              onClick={() => onSelect(g.id)}
            >
              <span className="group-name">{g.name}</span>
              <span className="group-excerpt">{excerpt(g.lastMessage)}</span>
            </button>
          </li>
        ))}
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
