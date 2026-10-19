import { getAgentGroup } from '../../db/agent-groups.js';
import { HttpError, type Route, ok } from './http.js';
import { listTasks } from './tasks.js';

export const panelRoute: Route = async (route, ctx) => {
  const match = /^GET \/api\/agent-groups\/([^/]+)(?:\/(library|tasks))?$/.exec(route);
  if (!match) return null;
  const [, rawId, tab] = match;
  const agentGroupId = decodeURIComponent(rawId);
  const group = await getAgentGroup(agentGroupId);
  if (!group) throw new HttpError(404, `unknown agent group ${agentGroupId}`);
  if (tab === 'library') return ok(ctx.store.listAgentFiles(agentGroupId));
  if (tab === 'tasks') return ok(await listTasks(agentGroupId));
  return ok({ id: group.id, name: group.name, folder: group.folder, createdAt: group.created_at });
};
