import { getAgentGroup } from '../../db/agent-groups.js';
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
  const perGroup = /^GET \/api\/agent-groups\/([^/]+)\/(library|routines)$/.exec(route);
  if (perGroup) {
    const [, rawId, tab] = perGroup;
    const agentGroupId = decodeURIComponent(rawId);
    if (!(await getAgentGroup(agentGroupId))) return notFound(`unknown agent group ${agentGroupId}`);
    if (tab === 'library') return { status: 200, body: ctx.store.listAgentFiles(agentGroupId) };
    return { status: 200, body: await listRoutines(agentGroupId) };
  }
  return null;
}

function notFound(error: string): PanelResponse {
  return { status: 404, body: { error } };
}
