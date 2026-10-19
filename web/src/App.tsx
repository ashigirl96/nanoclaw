import { useCallback, useEffect, useRef, useState } from 'react';

import { type AgentGroupSummary, type ChatMessage, type ConsoleEvent, api, awaitsAnswer, subscribe } from './api';
import { Chat } from './Chat';
import { Inbox } from './Inbox';
import { NewAgentDialog } from './NewAgentDialog';
import { announce, isForeground, useForeground, useNotificationPermission } from './notifications';
import { Panel } from './Panel';
import { Sidebar } from './Sidebar';
import { TimezoneContext } from './time';

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
  const [creating, setCreating] = useState(false);
  const [timezone, setTimezone] = useState<string | undefined>(undefined);
  const selected = view?.kind === 'chat' ? view.agentGroupId : null;

  useEffect(() => {
    api.agentGroups().then(setGroups, (err: Error) => setError(err.message));
    api.inbox().then(setInbox, (err: Error) => setError(err.message));
    api.settings().then(
      (s) => setTimezone(s.timezone),
      (err: Error) => setError(err.message),
    );
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

  const navigate = useCallback((next: Exclude<View, null>) => {
    const path = next.kind === 'inbox' ? '/inbox' : `/chat/${encodeURIComponent(next.agentGroupId)}`;
    window.history.pushState(null, '', path);
    setView(next);
  }, []);

  const groupsRef = useRef(groups);
  groupsRef.current = groups;

  useEffect(
    () =>
      subscribe((event: ConsoleEvent) => {
        if (event.type === 'message') {
          const { message } = event;
          if (message.agentGroupId === null) {
            setInbox((prev) => upsert(prev, message));
            return;
          }
          setGroups((prev) => prev.map((g) => (g.id === message.agentGroupId ? withLastMessage(g, message) : g)));
          if (message.agentGroupId === selected) setMessages((prev) => upsert(prev, message));
        } else if (event.type === 'activity') {
          setGroups((prev) => prev.map((g) => (g.id === event.agentGroupId ? { ...g, activity: event.activity } : g)));
        } else if (event.type === 'unread') {
          setGroups((prev) => prev.map((g) => (g.id === event.agentGroupId ? { ...g, unread: event.unread } : g)));
        } else if (event.type === 'agent-groups') {
          api.agentGroups().then(setGroups, (err: Error) => setError(err.message));
        } else if (event.type === 'notify') {
          const target = event.agentGroupId;
          const name = target ? (groupsRef.current.find((g) => g.id === target)?.name ?? target) : 'Inbox';
          announce(event, name, () => navigate(target ? { kind: 'chat', agentGroupId: target } : { kind: 'inbox' }));
        }
      }),
    [selected, navigate],
  );

  useNotificationPermission();

  const current = groups.find((g) => g.id === selected) ?? null;
  const waiting = inbox.filter((m) => m.card && awaitsAnswer(m.card)).length;
  const lastMessageId = messages.at(-1)?.id;
  const unreadHere = current?.unread ?? 0;
  const markSeen = useCallback(() => {
    if (!selected || !lastMessageId || unreadHere === 0 || !isForeground()) return;
    api.markRead(selected, lastMessageId).catch((err: Error) => setError(err.message));
  }, [selected, lastMessageId, unreadHere]);
  useEffect(markSeen, [markSeen]);
  useForeground(markSeen);

  const created = useCallback(
    async (id: string) => {
      setCreating(false);
      setGroups(await api.agentGroups());
      navigate({ kind: 'chat', agentGroupId: id });
    },
    [navigate],
  );

  return (
    <TimezoneContext.Provider value={timezone}>
      <div className={current ? 'layout with-panel' : 'layout'}>
        <Sidebar
          groups={groups}
          selected={selected}
          inboxSelected={view?.kind === 'inbox'}
          inboxWaiting={waiting}
          onSelect={(id) => navigate({ kind: 'chat', agentGroupId: id })}
          onSelectInbox={() => navigate({ kind: 'inbox' })}
          onNewAgent={() => setCreating(true)}
        />
        {creating && <NewAgentDialog onCreated={(id) => void created(id)} onClose={() => setCreating(false)} />}
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
        {current && <Panel key={current.id} agentGroupId={current.id} revision={messages.length} onError={setError} />}
      </div>
    </TimezoneContext.Provider>
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
