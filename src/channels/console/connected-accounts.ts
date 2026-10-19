import { HttpError, type Route, ok } from './http.js';

export interface OnecliEndpoint {
  url: string;
  /** Self-hosted OneCLI serves its dashboard on the API origin unless the operator names another. */
  dashboardUrl?: string;
  apiKey?: string;
}

export interface ConnectedApp {
  provider: string;
  name: string;
  connectUrl: string;
  accounts: Array<{ label: string; status: string; connectedAt: string | null }>;
}

const ONECLI_TIMEOUT_MS = 5000;

export function onecliEndpointFromEnv(env: Record<string, string | undefined>): OnecliEndpoint | null {
  if (env.NANOCLAW_GATEWAY_PROVIDER?.trim().toLowerCase() !== 'onecli') return null;
  const url = env.ONECLI_URL?.trim();
  if (!url) return null;
  const dashboardUrl = env.ONECLI_CONSOLE_URL?.trim();
  const apiKey = env.ONECLI_API_KEY?.trim();
  return { url, ...(dashboardUrl && { dashboardUrl }), ...(apiKey && { apiKey }) };
}

export function connectedAccountsRoute(onecli: OnecliEndpoint | null): Route {
  return async (route) => {
    if (!onecli || route !== 'GET /api/connected-accounts') return null;
    // OneCLI marks cloud-only apps unavailable; a self-hosted dashboard cannot connect them.
    const available = (await fetchApps(onecli)).filter((app) => app.available);
    return ok({ apps: available.map((app) => toConnectedApp(app, onecli)) });
  };
}

interface OnecliApp {
  id: string;
  name: string;
  available: boolean;
  connections?: Array<{ label?: string | null; status: string; connectedAt?: string | null }>;
}

async function fetchApps(onecli: OnecliEndpoint): Promise<OnecliApp[]> {
  let res: Response;
  try {
    res = await fetch(new URL('/v1/apps', onecli.url), {
      headers: onecli.apiKey ? { authorization: `Bearer ${onecli.apiKey}` } : {},
      signal: AbortSignal.timeout(ONECLI_TIMEOUT_MS),
    });
  } catch {
    throw new HttpError(502, 'OneCLI is unreachable');
  }
  if (!res.ok) throw new HttpError(502, `OneCLI answered ${res.status}`);
  const apps: unknown = await res.json().catch(() => null);
  if (!Array.isArray(apps)) throw new HttpError(502, 'OneCLI answered with an unexpected body');
  return apps as OnecliApp[];
}

// Builds the browser's view field by field: OneCLI's body also carries tokens and credential stubs.
function toConnectedApp(app: OnecliApp, onecli: OnecliEndpoint): ConnectedApp {
  const connectUrl = new URL('/connections', onecli.dashboardUrl ?? onecli.url);
  connectUrl.searchParams.set('connect', app.id);
  return {
    provider: app.id,
    name: app.name,
    connectUrl: connectUrl.toString(),
    accounts: (app.connections ?? []).map((c) => ({
      label: c.label ?? '',
      status: c.status,
      connectedAt: c.connectedAt ?? null,
    })),
  };
}
