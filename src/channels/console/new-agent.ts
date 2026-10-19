import { CreateAgentRequestError, createAgentFromConsole, listConsoleTemplates } from './create-agent.js';
import { HttpError, type Route, ok } from './http.js';

export const newAgentRoute: Route = async (route, ctx) => {
  if (route === 'GET /api/templates') return ok(listConsoleTemplates());
  if (route !== 'POST /api/agent-groups') return null;
  try {
    const outcome = await createAgentFromConsole(await ctx.readBody());
    if (outcome.status === 'denied') throw new HttpError(403, outcome.reason);
    return ok(outcome, outcome.status === 'created' ? 201 : 202);
  } catch (err) {
    if (err instanceof CreateAgentRequestError) throw new HttpError(400, err.message);
    throw err;
  }
};
