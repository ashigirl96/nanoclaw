import http from 'http';
import type { AddressInfo } from 'net';
import path from 'path';

import { DATA_DIR } from '../../config.js';
import { getAgentGroup, getAllAgentGroups } from '../../db/agent-groups.js';
import { log } from '../../log.js';
import type { ChannelAdapter, ChannelSetup } from '../adapter.js';
import {
  CHANNEL_TYPE,
  CONSOLE_DEFAULTS,
  OWNER_USER_ID,
  chatOf,
  ensureConsoleChat,
  platformIdFor,
  platformIdOfChat,
} from './chat.js';
import { mimeTypeFor } from './mime.js';
import { answerRoute, cardOf, lateAnswerText } from './questions.js';
import { serveStatic } from './static.js';
import { type ChatMessage, ConsoleStore, type NewFile } from './store.js';

type ConsoleEvent = { type: 'message'; message: ChatMessage };

export interface ConsoleOptions {
  port: number;
  dataDir: string;
  distDir: string;
}

export interface ConsoleAdapter extends ChannelAdapter {
  url(): string;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const MAX_BODY_BYTES = 50 * 1024 * 1024;
const EXPIRED_RESOLUTION = '⏱️ もう受け付けていません';

export function consoleAdapterFromEnv(env: Record<string, string | undefined>): ConsoleAdapter | null {
  if (!env.CONSOLE_PORT) return null;
  const port = Number(env.CONSOLE_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    log.warn('Console disabled: CONSOLE_PORT is not a valid port', { CONSOLE_PORT: env.CONSOLE_PORT });
    return null;
  }
  return createConsoleAdapter({ port, dataDir: DATA_DIR, distDir: path.resolve(process.cwd(), 'web', 'dist') });
}

export function createConsoleAdapter(opts: ConsoleOptions): ConsoleAdapter {
  let server: http.Server | null = null;
  let store: ConsoleStore | null = null;
  let setupConfig: ChannelSetup | null = null;
  const subscribers = new Set<http.ServerResponse>();

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

  async function requireAgentGroup(id: string): Promise<string> {
    if (!(await getAgentGroup(id))) throw new HttpError(404, `unknown agent group ${id}`);
    return id;
  }

  async function sendFromOwner(agentGroupId: string, body: Record<string, unknown>) {
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

  async function answerCard(messageId: string, body: Record<string, unknown>): Promise<ChatMessage> {
    const message = store!.getMessage(messageId);
    const card = message?.card;
    if (!message || !card || card.type === 'links') throw new HttpError(404, 'no card takes answers here');
    const option = card.options.find((o) => o.value === body.value);
    if (!option) throw new HttpError(400, 'value must be one of the card options');
    if (card.resolution !== null) throw new HttpError(409, 'the card is already answered');

    const route = await answerRoute(card);
    if (route !== 'deferred') {
      const resolution = route === 'expired' ? EXPIRED_RESOLUTION : option.selectedLabel;
      const resolved = store!.updateCard(message.agentGroupId, message.id, (c) =>
        c.type !== 'links' && c.resolution === null ? { ...c, resolution } : null,
      );
      if (!resolved) throw new HttpError(409, 'the card is already answered');
      broadcast({ type: 'message', message: resolved });
    }

    if (route === 'chat' && message.agentGroupId !== null) {
      await sendFromOwner(message.agentGroupId, { text: lateAnswerText(card, option) });
    } else if (route !== 'expired') {
      setupConfig!.onAction(card.questionId, option.value, OWNER_USER_ID, {
        messageId: message.id,
        platformId: platformIdOfChat(message.agentGroupId),
      });
    }
    return store!.getMessage(message.id)!;
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
        groups.map((g) => ({ id: g.id, name: g.name, lastMessage: store!.lastMessage(g.id) })),
      );
    }

    if (route === 'GET /api/inbox') return sendJson(res, 200, store!.listMessages(null));

    const answer = /^POST \/api\/messages\/([^/]+)\/answer$/.exec(route);
    if (answer) return sendJson(res, 200, await answerCard(decodeURIComponent(answer[1]), await readJson(req)));

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
      log.info('Console listening', { url: this.url() });
    },

    async teardown(): Promise<void> {
      if (server) {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server!.close(() => resolve()));
        server = null;
      }
      store?.close();
      store = null;
    },

    isConnected: () => server !== null,

    async deliver(platformId, _threadId, message): Promise<string | undefined> {
      const agentGroupId = chatOf(platformId);
      if (!store) return undefined;
      if (agentGroupId === undefined) {
        log.warn('Console dropped an Outbound Message for a platform id it has no Chat for', {
          platformId,
          kind: message.kind,
        });
        return undefined;
      }
      const content = (message.content ?? {}) as Record<string, unknown>;

      if (content.operation === 'edit' && typeof content.messageId === 'string') {
        const id = storeIdOf(content.messageId, agentGroupId);
        const resolution = terminalResolutionOf(content);
        const edited =
          resolution === null
            ? store.editMessage(agentGroupId, id, textOf(content))
            : store.updateCard(agentGroupId, id, (c) => (c.type === 'links' ? null : { ...c, resolution }));
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
      return stored.id;
    },

    url(): string {
      const { port } = server!.address() as AddressInfo;
      return `http://127.0.0.1:${port}`;
    },
  } satisfies ConsoleAdapter;
}

function isLocalHost(host: string | undefined): boolean {
  if (!host) return false;
  const hostname = host.replace(/:\d+$/, '');
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]';
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

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'request body too large');
    chunks.push(chunk as Buffer);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (err) {
    if (!(err instanceof SyntaxError)) throw err;
  }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  throw new HttpError(400, 'body must be a JSON object');
}
