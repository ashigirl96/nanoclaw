import type { AgentGroupSummary, ChatMessage } from './api';

interface Props {
  groups: AgentGroupSummary[];
  selected: string | null;
  onSelect: (id: string) => void;
}

export function Sidebar({ groups, selected, onSelect }: Props) {
  return (
    <nav className="sidebar" aria-label="Agent">
      <div className="sidebar-title">Console</div>
      <ul>
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
