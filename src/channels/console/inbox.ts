import { INBOX_CHAT_ID } from './chat.js';
import { type Route, ok } from './http.js';

export const inboxRoute: Route = async (route, ctx) =>
  route === 'GET /api/inbox' ? ok(ctx.store.listMessages(INBOX_CHAT_ID)) : null;
