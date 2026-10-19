import { useCallback, useEffect, useState } from 'react';

import { type AgentGroupSummary, type ChatMessage, api, subscribe } from './api';
import { Chat } from './Chat';
import { Sidebar } from './Sidebar';

function agentGroupIdFromPath(): string | null {
  const match = /^\/chat\/([^/]+)$/.exec(window.location.pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

export function App() {
  const [groups, setGroups] = useState<AgentGroupSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(agentGroupIdFromPath);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.agentGroups().then(setGroups, (err: Error) => setError(err.message));
    const onPop = () => setSelected(agentGroupIdFromPath());
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
        setGroups((prev) => prev.map((g) => (g.id === message.agentGroupId ? withLastMessage(g, message) : g)));
        if (message.agentGroupId !== selected) return;
        setMessages((prev) => upsert(prev, message));
      }),
    [selected],
  );

  const select = useCallback((id: string) => {
    window.history.pushState(null, '', `/chat/${encodeURIComponent(id)}`);
    setSelected(id);
  }, []);

  const current = groups.find((g) => g.id === selected) ?? null;

  return (
    <div className="layout">
      <Sidebar groups={groups} selected={selected} onSelect={select} />
      <main className="main">
        {error && (
          <div className="error" role="alert" onClick={() => setError(null)}>
            {error}
          </div>
        )}
        {current ? (
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
