import type http from 'http';

import { getAgentGroup } from '../../db/agent-groups.js';
import type { ChannelSetup } from '../adapter.js';
import type { Activity } from './activity.js';
import type { Notice } from './notify.js';
import type { ChatMessage, ConsoleStore } from './store.js';

const MAX_BODY_BYTES = 50 * 1024 * 1024;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export type ConsoleEvent =
  | { type: 'message'; message: ChatMessage }
  | { type: 'activity'; chatId: string; agentGroupId: string; activity: Activity }
  | { type: 'unread'; chatId: string; unread: number }
  | ({ type: 'notify' } & Notice)
  | { type: 'agent-groups' }
  | { type: 'group-chats' };

export interface OwnerMessageOptions {
  /** Agent Groups to wake in a Group Chat even when the text names no one. */
  addressedTo?: string[];
}

export interface RouteContext {
  store: ConsoleStore;
  readBody(): Promise<Record<string, unknown>>;
  broadcast(event: ConsoleEvent): void;
  sendFromOwner(chatId: string, body: Record<string, unknown>, options?: OwnerMessageOptions): Promise<ChatMessage>;
  onAction: ChannelSetup['onAction'];
  activityOf(chatId: string, agentGroupId: string): Activity;
}

export interface RouteResponse {
  status: number;
  body: unknown;
}

/** Answers `route` (`<METHOD> <path>`), or returns null when the route is not its own. */
export type Route = (route: string, ctx: RouteContext) => Promise<RouteResponse | null>;

export function ok(body: unknown, status = 200): RouteResponse {
  return { status, body };
}

export async function requireAgentGroup(id: string): Promise<string> {
  if (!(await getAgentGroup(id))) throw new HttpError(404, `unknown agent group ${id}`);
  return id;
}

export function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

export async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
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
