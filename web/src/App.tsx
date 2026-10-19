import { useCallback, useEffect, useState } from 'react';

import { type AgentGroupSummary, type ChatMessage, api, subscribe } from './api';
import { Chat } from './Chat';
import { Inbox } from './Inbox';
import { Sidebar } from './Sidebar';

type View = { kind: 'inbox' } | { kind: 'chat'; agentGroupId: string } | null;

function viewFromPath(): View {
  if (window.location.pathname === '/inbox') return { kind: 'inbox' };
  const match = /^\/chat\/([^/]+)$/.exec(window.location.pathname);
  return match ? { kind: 'chat', agentGroupId: decodeURIComponent(match[1]) } : null;
}

export function App() {
  const [groups, setGroups] = useState<AgentGroupSummary[]>([]);
  const [view, setView] = useState<View>(viewFromPath);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inbox, setInbox] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const selected = view?.kind === 'chat' ? view.agentGroupId : null;

  useEffect(() => {
    api.agentGroups().then(setGroups, (err: Error) => setError(err.message));
    api.inbox().then(setInbox, (err: Error) => setError(err.message));
    const onPop = () => setView(viewFromPath());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    if (!selected) return;
    setMessages([]);
    api.open(selected).then(
      (chat) => setMessages(chat.messages),
      (err: Error) => setError(err.message),
    );
  }, [selected]);

  useEffect(
    () =>
      subscribe((event) => {
        const { message } = event;
        if (message.agentGroupId === null) {
          setInbox((prev) => upsert(prev, message));
          return;
        }
        setGroups((prev) => prev.map((g) => (g.id === message.agentGroupId ? withLastMessage(g, message) : g)));
        if (message.agentGroupId !== selected) return;
        setMessages((prev) => upsert(prev, message));
      }),
    [selected],
  );

  const navigate = useCallback((next: Exclude<View, null>) => {
    const path = next.kind === 'inbox' ? '/inbox' : `/chat/${encodeURIComponent(next.agentGroupId)}`;
    window.history.pushState(null, '', path);
    setView(next);
  }, []);

  const current = groups.find((g) => g.id === selected) ?? null;
  const waiting = inbox.filter((m) => m.card && m.card.type !== 'links' && m.card.resolution === null).length;

  return (
    <div className="layout">
      <Sidebar
        groups={groups}
        selected={selected}
        inboxSelected={view?.kind === 'inbox'}
        inboxWaiting={waiting}
        onSelect={(id) => navigate({ kind: 'chat', agentGroupId: id })}
        onSelectInbox={() => navigate({ kind: 'inbox' })}
      />
      <main className="main">
        {error && (
          <div className="error" role="alert" onClick={() => setError(null)}>
            {error}
          </div>
        )}
        {view?.kind === 'inbox' ? (
          <Inbox messages={inbox} onUpdated={(m) => setInbox((prev) => upsert(prev, m))} onError={setError} />
        ) : current ? (
          <Chat
            key={current.id}
            group={current}
            messages={messages}
            onSent={(m) => setMessages((prev) => upsert(prev, m))}
            onError={setError}
          />
        ) : (
          <div className="empty">左の一覧から Agent を選んでください。</div>
        )}
      </main>
    </div>
  );
}

function upsert(messages: ChatMessage[], message: ChatMessage): ChatMessage[] {
  const index = messages.findIndex((m) => m.id === message.id);
  if (index === -1) return [...messages, message];
  return messages.map((m, i) => (i === index ? message : m));
}

function withLastMessage(group: AgentGroupSummary, message: ChatMessage): AgentGroupSummary {
  const last = group.lastMessage;
  // An edit to an older message must not replace a newer excerpt.
  if (last && last.id !== message.id && last.createdAt > message.createdAt) return group;
  return { ...group, lastMessage: message };
}
