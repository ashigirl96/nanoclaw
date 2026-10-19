import { type Route, ok } from './http.js';

export const inboxRoute: Route = async (route, ctx) =>
  route === 'GET /api/inbox' ? ok(ctx.store.listMessages(null)) : null;
