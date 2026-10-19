import { getAgentGroup } from '../../db/agent-groups.js';
import { CreateAgentRequestError, createAgentFromConsole, listConsoleTemplates } from './create-agent.js';
import { listRoutines } from './routines.js';
import type { ConsoleStore } from './store.js';

export interface PanelResponse {
  status: number;
  body: unknown;
}

export interface PanelContext {
  store: ConsoleStore;
  readBody: () => Promise<Record<string, unknown>>;
}

/** The right-hand panel's API (details, Library, Routine) and the "+" flow. Returns null for other routes. */
export async function panelRoute(route: string, ctx: PanelContext): Promise<PanelResponse | null> {
  const perGroup = /^GET \/api\/agent-groups\/([^/]+)(?:\/(library|routines))?$/.exec(route);
  if (perGroup) {
    const [, rawId, tab] = perGroup;
    const agentGroupId = decodeURIComponent(rawId);
    const group = await getAgentGroup(agentGroupId);
    if (!group) return error(404, `unknown agent group ${agentGroupId}`);
    if (!tab)
      return {
        status: 200,
        body: { id: group.id, name: group.name, folder: group.folder, createdAt: group.created_at },
      };
    if (tab === 'library') return { status: 200, body: ctx.store.listAgentFiles(agentGroupId) };
    return { status: 200, body: await listRoutines(agentGroupId) };
  }

  if (route === 'GET /api/templates') return { status: 200, body: listConsoleTemplates() };

  if (route === 'POST /api/agent-groups') {
    try {
      const outcome = await createAgentFromConsole(await ctx.readBody());
      if (outcome.status === 'denied') return error(403, outcome.reason);
      return { status: outcome.status === 'created' ? 201 : 202, body: outcome };
    } catch (err) {
      if (err instanceof CreateAgentRequestError) return error(400, err.message);
      throw err;
    }
  }

  return null;
}

function error(status: number, message: string): PanelResponse {
  return { status, body: { error: message } };
}
