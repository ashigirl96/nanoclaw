import http from 'http';
import type { AddressInfo } from 'net';
import path from 'path';

import { DATA_DIR } from '../../config.js';
import { getAllAgentGroups } from '../../db/agent-groups.js';
import { log } from '../../log.js';
import type { ChannelAdapter, ChannelSetup } from '../adapter.js';
import { ActivityBoard, currentToolOf, isMidTurn } from './activity.js';
import { answersRoute } from './answers.js';
import { isAnswerable } from './cards.js';
import {
  CHANNEL_TYPE,
  CONSOLE_DEFAULTS,
  OWNER_USER_ID,
  agentGroupIdFrom,
  chatOf,
  ensureConsoleChat,
  platformIdFor,
  storeKeyOf,
} from './chat.js';
import { type OnecliEndpoint, connectedAccountsRoute, onecliEndpointFromEnv } from './connected-accounts.js';
import { onAgentGroupsChanged } from './create-agent.js';
import {
  type ConsoleEvent,
  HttpError,
  type Route,
  type RouteContext,
  readJson,
  requireAgentGroup,
  sendJson,
} from './http.js';
import { inboxRoute } from './inbox.js';
import { mimeTypeFor } from './mime.js';
import { newAgentRoute } from './new-agent.js';
import { noticeFor } from './notify.js';
import { panelRoute } from './panel.js';
import { cardOf } from './questions.js';
import { settingsRoute } from './settings.js';
import { serveStatic } from './static.js';
import { type ChatMessage, ConsoleStore, type NewFile } from './store.js';
import { broadcastUnread, readRoute } from './unread.js';

export interface ConsoleOptions {
  port: number;
  dataDir: string;
  distDir: string;
  /** Set only when the Install's Gateway is OneCLI. */
  onecli?: OnecliEndpoint | null;
}

export interface ConsoleAdapter extends ChannelAdapter {
  url(): string;
}

export function consoleAdapterFromEnv(env: Record<string, string | undefined>): ConsoleAdapter | null {
  if (!env.CONSOLE_PORT) return null;
  const port = Number(env.CONSOLE_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    log.warn('Console disabled: CONSOLE_PORT is not a valid port', { CONSOLE_PORT: env.CONSOLE_PORT });
    return null;
  }
  return createConsoleAdapter({
    port,
    dataDir: DATA_DIR,
    distDir: path.resolve(process.cwd(), 'web', 'dist'),
    onecli: onecliEndpointFromEnv(env),
  });
}

export function createConsoleAdapter(opts: ConsoleOptions): ConsoleAdapter {
  const onecli = opts.onecli ?? null;
  const routes: Route[] = [
    answersRoute,
    inboxRoute,
    readRoute,
    panelRoute,
    newAgentRoute,
    settingsRoute({ connectedAccounts: onecli !== null }),
    connectedAccountsRoute(onecli),
  ];
  let server: http.Server | null = null;
  let store: ConsoleStore | null = null;
  let setupConfig: ChannelSetup | null = null;
  let stopWatchingAgentGroups: (() => void) | null = null;
  const subscribers = new Set<http.ServerResponse>();
  const activity = new ActivityBoard((agentGroupId, next) =>
    broadcast({ type: 'activity', agentGroupId, activity: next }),
  );

  function broadcast(event: ConsoleEvent): void {
    const frame = `data: ${JSON.stringify(event)}\n\n`;
    for (const res of subscribers) res.write(frame);
  }

  function subscribe(req: http.IncomingMessage, res: http.ServerResponse): void {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    res.write(': connected\n\n');
    subscribers.add(res);
    req.on('close', () => subscribers.delete(res));
  }

  async function sendFromOwner(agentGroupId: string, body: Record<string, unknown>): Promise<ChatMessage> {
    const text = typeof body.text === 'string' ? body.text : '';
    const files = parseUploads(body.files);
    if (!text && files.length === 0) throw new HttpError(400, 'text or files is required');
    await ensureConsoleChat(agentGroupId);
    const message = store!.addMessage({ agentGroupId, role: 'owner', text, files });
    broadcast({ type: 'message', message });
    await setupConfig!.onInbound(platformIdFor(agentGroupId), null, {
      id: message.id,
      kind: 'chat',
      timestamp: message.createdAt,
      content: {
        text,
        sender: 'Owner',
        senderId: OWNER_USER_ID,
        ...(files.length > 0 && {
          attachments: files.map((f) => ({
            type: f.mimeType.startsWith('image/') ? 'image' : 'file',
            name: f.name,
            mimeType: f.mimeType,
            data: f.data.toString('base64'),
          })),
        }),
      },
    });
    return message;
  }

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://console');
    const route = `${req.method} ${url.pathname}`;

    if (!isLocalHost(req.headers.host)) throw new HttpError(403, 'Console only answers to localhost');
    // A JSON content type forces a CORS preflight, which other sites cannot pass.
    if (req.method !== 'GET' && !req.headers['content-type']?.startsWith('application/json')) {
      throw new HttpError(415, 'content-type must be application/json');
    }

    if (route === 'GET /api/events') return subscribe(req, res);

    if (route === 'GET /api/agent-groups') {
      const groups = await getAllAgentGroups();
      return sendJson(
        res,
        200,
        groups.map((g) => ({
          id: g.id,
          name: g.name,
          lastMessage: store!.lastMessage(g.id),
          activity: activity.get(g.id),
          unread: store!.unreadCount(g.id),
        })),
      );
    }

    const file = /^GET \/api\/files\/([^/]+)$/.exec(route);
    if (file) {
      const stored = store!.getFile(decodeURIComponent(file[1]));
      if (!stored) throw new HttpError(404, 'unknown file');
      res.writeHead(200, {
        'content-type': stored.mimeType,
        'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(stored.name)}`,
        'x-content-type-options': 'nosniff',
        // Chrome's PDF viewer refuses to render inside a sandboxed document.
        ...(stored.mimeType !== 'application/pdf' && { 'content-security-policy': 'sandbox' }),
      });
      res.end(stored.data);
      return;
    }

    const chat = /^(GET|POST) \/api\/agent-groups\/([^/]+)\/(open|messages)$/.exec(route);
    if (chat) {
      const [, method, rawId, action] = chat;
      const agentGroupId = await requireAgentGroup(decodeURIComponent(rawId));
      if (method === 'POST' && action === 'open') {
        await ensureConsoleChat(agentGroupId);
        return sendJson(res, 200, { messages: store!.listMessages(agentGroupId) });
      }
      if (method === 'GET' && action === 'messages') {
        return sendJson(res, 200, store!.listMessages(agentGroupId));
      }
      if (method === 'POST' && action === 'messages') {
        return sendJson(res, 200, await sendFromOwner(agentGroupId, await readJson(req)));
      }
    }

    const ctx: RouteContext = {
      store: store!,
      readBody: () => readJson(req),
      broadcast,
      sendFromOwner,
      onAction: (...args) => setupConfig!.onAction(...args),
    };
    for (const answerRoute of routes) {
      const response = await answerRoute(route, ctx);
      if (response) return sendJson(res, response.status, response.body);
    }

    if (req.method === 'GET' && !url.pathname.startsWith('/api/')) return serveStatic(opts.distDir, url.pathname, res);

    throw new HttpError(404, 'not found');
  }

  return {
    name: CHANNEL_TYPE,
    channelType: CHANNEL_TYPE,
    supportsThreads: false,
    defaults: CONSOLE_DEFAULTS,

    async setup(config: ChannelSetup): Promise<void> {
      setupConfig = config;
      store = new ConsoleStore(path.join(opts.dataDir, 'console.db'));
      stopWatchingAgentGroups = onAgentGroupsChanged(() => broadcast({ type: 'agent-groups' }));
      server = http.createServer((req, res) => {
        handle(req, res).catch((err) => {
          if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message });
          log.error('Console request failed', { url: req.url, err });
          if (!res.headersSent) sendJson(res, 500, { error: 'internal error' });
        });
      });
      await new Promise<void>((resolve, reject) => {
        server!.once('error', reject);
        server!.listen(opts.port, '127.0.0.1', () => resolve());
      });
      const { port } = server!.address() as AddressInfo;
      log.info('Console listening', { url: `http://${CONSOLE_HOSTNAME}:${port}` });
    },

    async teardown(): Promise<void> {
      stopWatchingAgentGroups?.();
      if (server) {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server!.close(() => resolve()));
        server = null;
      }
      activity.dispose();
      store?.close();
      store = null;
    },

    isConnected: () => server !== null,

    async setTyping(platformId): Promise<void> {
      const agentGroupId = agentGroupIdFrom(platformId);
      if (!agentGroupId || !store) return;
      activity.touch(agentGroupId, await currentToolOf(agentGroupId, platformId));
    },

    async deliver(platformId, _threadId, message): Promise<string | undefined> {
      if (!store) return undefined;
      const chat = chatOf(platformId);
      if (!chat) {
        log.warn('Console dropped an Outbound Message for a platform id it has no Chat for', {
          platformId,
          kind: message.kind,
        });
        return undefined;
      }
      const agentGroupId = storeKeyOf(chat);
      const notice = noticeFor(chat, message);
      if (notice) broadcast({ type: 'notify', ...notice });
      const content = (message.content ?? {}) as Record<string, unknown>;

      if (content.operation === 'edit' && typeof content.messageId === 'string') {
        const id = storeIdOf(content.messageId, agentGroupId);
        const resolution = terminalResolutionOf(content);
        const edited =
          resolution === null
            ? store.editMessage(agentGroupId, id, textOf(content))
            : store.updateCard(agentGroupId, id, (c) => (isAnswerable(c) ? { ...c, resolution } : null));
        if (edited) broadcast({ type: 'message', message: edited });
        return undefined;
      }
      if (
        content.operation === 'reaction' &&
        typeof content.messageId === 'string' &&
        typeof content.emoji === 'string'
      ) {
        const reacted = store.addReaction(agentGroupId, storeIdOf(content.messageId, agentGroupId), content.emoji);
        if (reacted) broadcast({ type: 'message', message: reacted });
        return undefined;
      }

      const files = (message.files ?? []).map((f) => ({
        name: f.filename,
        mimeType: mimeTypeFor(f.filename),
        data: f.data,
      }));
      const carded = await cardOf(content);
      const stored = store.addMessage({
        agentGroupId,
        role: 'agent',
        text: carded?.text ?? textOf(content),
        files,
        card: carded?.card,
      });
      broadcast({ type: 'message', message: stored });
      if (agentGroupId !== null) {
        broadcastUnread({ store, broadcast }, agentGroupId);
        // The message is already stored, so a failed read must not fail the delivery and get it sent twice.
        if (await isMidTurn(agentGroupId, platformId).catch(() => false)) activity.holdThroughDelivery(agentGroupId);
        else activity.clear(agentGroupId);
      }
      return stored.id;
    },

    url(): string {
      const { port } = server!.address() as AddressInfo;
      return `http://127.0.0.1:${port}`;
    },
  } satisfies ConsoleAdapter;
}

// Browsers resolve *.localhost to loopback themselves, so DNS rebinding cannot reach this name.
const CONSOLE_HOSTNAME = 'nanoclaw.localhost';

function isLocalHost(host: string | undefined): boolean {
  if (!host) return false;
  const hostname = host.replace(/:\d+$/, '');
  return hostname === CONSOLE_HOSTNAME || hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]';
}

function parseUploads(raw: unknown): NewFile[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new HttpError(400, 'files must be an array');
  return raw.map((f: Record<string, unknown>) => {
    if (typeof f?.name !== 'string' || !f.name || typeof f.data !== 'string') {
      throw new HttpError(400, 'each file needs a name and base64 data');
    }
    return {
      name: path.basename(f.name),
      mimeType: typeof f.mimeType === 'string' && f.mimeType ? f.mimeType : mimeTypeFor(f.name),
      data: Buffer.from(f.data, 'base64'),
    };
  });
}

// The router stores an Owner message for the Agent as `<inbound id>:<agentGroupId>`, and edit/reaction echo that id back.
function storeIdOf(messageId: string, agentGroupId: string | null): string {
  if (agentGroupId === null) return messageId;
  const suffix = `:${agentGroupId}`;
  return messageId.endsWith(suffix) ? messageId.slice(0, -suffix.length) : messageId;
}

function terminalResolutionOf(content: Record<string, unknown>): string | null {
  const terminal = content.terminalCard as { resolution?: unknown } | undefined;
  return typeof terminal?.resolution === 'string' ? terminal.resolution : null;
}

function textOf(content: Record<string, unknown>): string {
  if (typeof content.markdown === 'string') return content.markdown;
  return typeof content.text === 'string' ? content.text : '';
}
