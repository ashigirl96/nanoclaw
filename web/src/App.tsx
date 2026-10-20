import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react';

import {
  type AgentGroupSummary,
  type ChatMessage,
  type ConsoleEvent,
  type GroupChatSummary,
  INBOX_CHAT_ID,
  api,
  awaitsAnswer,
  subscribe,
} from './api';
import { Avatar } from './Avatar';
import { Chat } from './Chat';
import { ConnectedAccounts } from './ConnectedAccounts';
import { GroupChatSettingsDialog, NewGroupChatDialog } from './GroupChatDialogs';
import { GroupIcon, PanelIcon } from './Icons';
import { Inbox } from './Inbox';
import { NewAgentDialog } from './NewAgentDialog';
import { announce, isForeground, useForeground, useNotificationPermission } from './notifications';
import { Panel } from './Panel';
import { ResizeHandle, useStoredWidth } from './Resizer';
import { Sidebar } from './Sidebar';
import { TimezoneContext } from './time';

type View =
  | { kind: 'inbox' }
  | { kind: 'accounts' }
  | { kind: 'chat'; agentGroupId: string }
  | { kind: 'group-chat'; groupChatId: string }
  | null;

type Dialog = 'new-agent' | 'new-group-chat' | 'group-chat-settings' | null;

const SIDEBAR_WIDTH = { initial: 264, min: 200, max: 480 };
const PANEL_WIDTH = { initial: 320, min: 260, max: 600 };

function viewFromPath(): View {
  if (window.location.pathname === '/inbox') return { kind: 'inbox' };
  if (window.location.pathname === '/accounts') return { kind: 'accounts' };
  const groupChat = /^\/group-chat\/([^/]+)$/.exec(window.location.pathname);
  if (groupChat) return { kind: 'group-chat', groupChatId: decodeURIComponent(groupChat[1]) };
  const match = /^\/chat\/([^/]+)$/.exec(window.location.pathname);
  return match ? { kind: 'chat', agentGroupId: decodeURIComponent(match[1]) } : null;
}

function pathOf(view: Exclude<View, null>): string {
  if (view.kind === 'inbox' || view.kind === 'accounts') return `/${view.kind}`;
  if (view.kind === 'group-chat') return `/group-chat/${encodeURIComponent(view.groupChatId)}`;
  return `/chat/${encodeURIComponent(view.agentGroupId)}`;
}

export function App() {
  const [groups, setGroups] = useState<AgentGroupSummary[]>([]);
  const [groupChats, setGroupChats] = useState<GroupChatSummary[]>([]);
  const [view, setView] = useState<View>(viewFromPath);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inbox, setInbox] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [timezone, setTimezone] = useState<string | undefined>(undefined);
  const [hasConnectedAccounts, setHasConnectedAccounts] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useStoredWidth('console.sidebarWidth', SIDEBAR_WIDTH);
  const [panelWidth, setPanelWidth] = useStoredWidth('console.panelWidth', PANEL_WIDTH);
  const selected = view?.kind === 'chat' ? view.agentGroupId : null;
  const selectedGroupChat = view?.kind === 'group-chat' ? view.groupChatId : null;
  const current = groups.find((g) => g.id === selected) ?? null;
  const currentGroupChat = groupChats.find((c) => c.id === selectedGroupChat) ?? null;
  // From the URL, not the lists, so SSE events that arrive before the lists load still reach the open Chat.
  const selectedChatId = selected ? `ag:${selected}` : selectedGroupChat ? `gc:${selectedGroupChat}` : null;

  const reloadGroupChats = useCallback(
    () => api.groupChats().then(setGroupChats, (err: Error) => setError(err.message)),
    [],
  );

  useEffect(() => {
    api.agentGroups().then(setGroups, (err: Error) => setError(err.message));
    void reloadGroupChats();
    api.inbox().then(setInbox, (err: Error) => setError(err.message));
    api.settings().then(
      (s) => {
        setTimezone(s.timezone);
        setHasConnectedAccounts(s.connectedAccounts);
      },
      (err: Error) => setError(err.message),
    );
    const onPop = () => setView(viewFromPath());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [reloadGroupChats]);

  useEffect(() => {
    if (!selected && !selectedGroupChat) return;
    let stale = false;
    setMessages([]);
    const loaded = selected
      ? api.open(selected).then((chat) => chat.messages)
      : api.groupChatMessages(selectedGroupChat!);
    loaded.then(
      (list) => !stale && setMessages(list),
      (err: Error) => !stale && setError(err.message),
    );
    return () => {
      stale = true;
    };
  }, [selected, selectedGroupChat]);

  const navigate = useCallback((next: Exclude<View, null>) => {
    window.history.pushState(null, '', pathOf(next));
    setView(next);
  }, []);

  const groupsRef = useRef(groups);
  groupsRef.current = groups;
  const groupChatsRef = useRef(groupChats);
  groupChatsRef.current = groupChats;

  const updateChat = useCallback(
    (chatId: string, update: <T extends AgentGroupSummary | GroupChatSummary>(chat: T) => T) => {
      setGroups((prev) => prev.map((g) => (g.chatId === chatId ? update(g) : g)));
      setGroupChats((prev) => prev.map((c) => (c.chatId === chatId ? update(c) : c)));
    },
    [],
  );

  useEffect(
    () =>
      subscribe((event: ConsoleEvent) => {
        if (event.type === 'message') {
          const { message } = event;
          if (message.chatId === INBOX_CHAT_ID) {
            setInbox((prev) => upsert(prev, message));
            return;
          }
          updateChat(message.chatId, (chat) => withLastMessage(chat, message));
          if (message.chatId === selectedChatId) setMessages((prev) => upsert(prev, message));
        } else if (event.type === 'activity') {
          setGroups((prev) => prev.map((g) => (g.chatId === event.chatId ? { ...g, activity: event.activity } : g)));
          setGroupChats((prev) =>
            prev.map((c) =>
              c.chatId === event.chatId
                ? { ...c, activity: { ...c.activity, [event.agentGroupId]: event.activity } }
                : c,
            ),
          );
        } else if (event.type === 'unread') {
          updateChat(event.chatId, (chat) => ({ ...chat, unread: event.unread }));
        } else if (event.type === 'agent-groups') {
          api.agentGroups().then(setGroups, (err: Error) => setError(err.message));
          void reloadGroupChats();
        } else if (event.type === 'group-chats') {
          void reloadGroupChats();
        } else if (event.type === 'notify') {
          const group = groupsRef.current.find((g) => g.chatId === event.chatId);
          const groupChat = groupChatsRef.current.find((c) => c.chatId === event.chatId);
          const name = group?.name ?? groupChat?.name ?? 'Inbox';
          const target: Exclude<View, null> = group
            ? { kind: 'chat', agentGroupId: group.id }
            : groupChat
              ? { kind: 'group-chat', groupChatId: groupChat.id }
              : { kind: 'inbox' };
          announce(event, name, () => navigate(target));
        }
      }),
    [selectedChatId, navigate, reloadGroupChats, updateChat],
  );

  useNotificationPermission();

  const waiting = inbox.filter((m) => m.card && awaitsAnswer(m.card)).length;
  // Right after a switch, messages still hold the previous Chat until the new one loads.
  const last = messages.at(-1);
  const lastMessageId = last && last.chatId === selectedChatId ? last.id : undefined;
  const unreadHere = current?.unread ?? currentGroupChat?.unread ?? 0;
  const markSeen = useCallback(() => {
    if (!lastMessageId || unreadHere === 0 || !isForeground()) return;
    const read = selected
      ? api.markRead(selected, lastMessageId)
      : selectedGroupChat
        ? api.markGroupChatRead(selectedGroupChat, lastMessageId)
        : null;
    read?.catch((err: Error) => setError(err.message));
  }, [selected, selectedGroupChat, lastMessageId, unreadHere]);
  useEffect(markSeen, [markSeen]);
  useForeground(markSeen);

  const created = useCallback(
    async (id: string) => {
      setDialog(null);
      setGroups(await api.agentGroups());
      navigate({ kind: 'chat', agentGroupId: id });
    },
    [navigate],
  );

  const createdGroupChat = useCallback(
    async (id: string) => {
      setDialog(null);
      await reloadGroupChats();
      navigate({ kind: 'group-chat', groupChatId: id });
    },
    [navigate, reloadGroupChats],
  );

  const upsertMessage = (m: ChatMessage) => setMessages((prev) => upsert(prev, m));

  return (
    <TimezoneContext.Provider value={timezone}>
      <div
        className={current && panelOpen ? 'layout with-panel' : 'layout'}
        style={{ '--sidebar-width': `${sidebarWidth}px`, '--panel-width': `${panelWidth}px` } as CSSProperties}
      >
        <Sidebar
          groups={groups}
          groupChats={groupChats}
          selected={selectedChatId}
          inboxSelected={view?.kind === 'inbox'}
          inboxWaiting={waiting}
          accountsVisible={hasConnectedAccounts}
          accountsSelected={view?.kind === 'accounts'}
          onSelect={(id) => navigate({ kind: 'chat', agentGroupId: id })}
          onSelectGroupChat={(id) => navigate({ kind: 'group-chat', groupChatId: id })}
          onSelectInbox={() => navigate({ kind: 'inbox' })}
          onSelectAccounts={() => navigate({ kind: 'accounts' })}
          onNewAgent={() => setDialog('new-agent')}
          onNewGroupChat={() => setDialog('new-group-chat')}
        />
        <ResizeHandle
          edge="right"
          label="サイドバーの幅"
          width={sidebarWidth}
          bounds={SIDEBAR_WIDTH}
          onResize={setSidebarWidth}
        />
        {dialog === 'new-agent' && (
          <NewAgentDialog onCreated={(id) => void created(id)} onClose={() => setDialog(null)} />
        )}
        {dialog === 'new-group-chat' && (
          <NewGroupChatDialog
            groups={groups}
            onCreated={(id) => void createdGroupChat(id)}
            onClose={() => setDialog(null)}
          />
        )}
        {dialog === 'group-chat-settings' && currentGroupChat && (
          <GroupChatSettingsDialog
            chat={currentGroupChat}
            groups={groups}
            onChanged={(chat) => setGroupChats((prev) => prev.map((c) => (c.id === chat.id ? chat : c)))}
            onDeleted={() => {
              setDialog(null);
              setGroupChats((prev) => prev.filter((c) => c.id !== currentGroupChat.id));
              window.history.pushState(null, '', '/');
              setView(null);
            }}
            onClose={() => setDialog(null)}
          />
        )}
        <main className="main">
          {error && (
            <div className="error" role="alert" onClick={() => setError(null)}>
              {error}
            </div>
          )}
          {view?.kind === 'inbox' ? (
            <Inbox messages={inbox} onUpdated={(m) => setInbox((prev) => upsert(prev, m))} onError={setError} />
          ) : view?.kind === 'accounts' && hasConnectedAccounts ? (
            <ConnectedAccounts />
          ) : current ? (
            <Chat
              key={current.chatId}
              title={
                <>
                  <button
                    type="button"
                    className="chat-pill"
                    aria-expanded={panelOpen}
                    onClick={() => setPanelOpen((open) => !open)}
                  >
                    <Avatar id={current.id} name={current.name} url={current.avatarUrl} size="sm" />
                    {current.name}
                  </button>
                  {!panelOpen && (
                    <button
                      type="button"
                      className="icon-button chat-panel-toggle"
                      aria-label="パネルを開く"
                      onClick={() => setPanelOpen(true)}
                    >
                      <PanelIcon />
                    </button>
                  )}
                </>
              }
              messages={messages}
              working={
                current.activity.working ? [{ id: current.id, name: current.name, activity: current.activity }] : []
              }
              send={(text, uploads) => api.send(current.id, text, uploads)}
              onSent={upsertMessage}
              onError={setError}
            />
          ) : currentGroupChat ? (
            <Chat
              key={currentGroupChat.chatId}
              title={
                <button
                  type="button"
                  className="chat-pill"
                  aria-label={`${currentGroupChat.name} の参加者`}
                  onClick={() => setDialog('group-chat-settings')}
                >
                  <span className="avatar sm inbox-avatar" aria-hidden="true">
                    <GroupIcon />
                  </span>
                  {currentGroupChat.name}
                  <span className="chat-pill-meta">{currentGroupChat.members.length} 人</span>
                </button>
              }
              messages={messages}
              working={currentGroupChat.members
                .map((m) => ({ ...m, activity: currentGroupChat.activity[m.id] ?? { working: false, tool: null } }))
                .filter((m) => m.activity.working)}
              members={currentGroupChat.members}
              nameOf={(id) => groups.find((g) => g.id === id)?.name ?? id}
              send={(text, uploads) => api.sendToGroupChat(currentGroupChat.id, text, uploads)}
              onSent={upsertMessage}
              onError={setError}
            />
          ) : (
            <div className="empty">左の一覧から Agent を選んでください。</div>
          )}
        </main>
        {current && panelOpen && (
          <ResizeHandle
            edge="left"
            label="パネルの幅"
            width={panelWidth}
            bounds={PANEL_WIDTH}
            onResize={setPanelWidth}
          />
        )}
        {current && panelOpen && (
          <Panel
            key={current.id}
            group={current}
            revision={messages.length}
            onClose={() => setPanelOpen(false)}
            onError={setError}
          />
        )}
      </div>
    </TimezoneContext.Provider>
  );
}

function upsert(messages: ChatMessage[], message: ChatMessage): ChatMessage[] {
  const index = messages.findIndex((m) => m.id === message.id);
  if (index === -1) return [...messages, message];
  return messages.map((m, i) => (i === index ? message : m));
}

function withLastMessage<T extends { lastMessage: ChatMessage | null }>(chat: T, message: ChatMessage): T {
  const last = chat.lastMessage;
  // An edit to an older message must not replace a newer excerpt.
  if (last && last.id !== message.id && last.createdAt > message.createdAt) return chat;
  return { ...chat, lastMessage: message };
}
