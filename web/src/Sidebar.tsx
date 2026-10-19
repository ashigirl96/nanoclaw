import type { AgentGroupSummary, ChatMessage } from './api';

interface Props {
  groups: AgentGroupSummary[];
  selected: string | null;
  onSelect: (id: string) => void;
  onNewAgent: () => void;
}

export function Sidebar({ groups, selected, onSelect, onNewAgent }: Props) {
  return (
    <nav className="sidebar" aria-label="Agent">
      <div className="sidebar-title">
        Console
        <button type="button" className="new-agent-button" aria-label="Agent を作る" onClick={onNewAgent}>
          +
        </button>
      </div>
      <ul>
        {groups.map((g) => (
          <li key={g.id}>
            <button
              type="button"
              className={['group', g.id === selected && 'selected', g.unread > 0 && 'unread'].filter(Boolean).join(' ')}
              onClick={() => onSelect(g.id)}
            >
              <span className="group-head">
                <span className="group-name">{g.name}</span>
                {g.activity.working && <span className="working-dot" title="作業中" aria-label="作業中" />}
                {g.unread > 0 && (
                  <span className="unread-badge" aria-label={`未読 ${g.unread} 件`}>
                    {g.unread}
                  </span>
                )}
              </span>
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
