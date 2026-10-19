/**
 * Console — the Owner-only web Platform the Host serves itself.
 *
 * Listens on 127.0.0.1:$CONSOLE_PORT, opened as http://nanoclaw.localhost:$CONSOLE_PORT.
 * Serves web/dist plus a JSON API, and pushes Chat updates over SSE. Each Agent
 * Group gets one Chat, wired on first open, and the Owner can make Group Chats
 * whose participants answer only when Mentioned (docs/adr/0003). The Chat
 * history lives in data/console.db (docs/adr/0001).
 */
import { readEnvFile } from '../../env.js';
import { configuredGatewayProviderKind } from '../../gateway-providers/index.js';
import { registerChannelAdapter } from '../channel-registry.js';
import { consoleAdapterFromEnv } from './adapter.js';
import { CHANNEL_TYPE, CONSOLE_DEFAULTS } from './chat.js';

const ONECLI_KEYS = ['ONECLI_URL', 'ONECLI_CONSOLE_URL', 'ONECLI_API_KEY'];

registerChannelAdapter(CHANNEL_TYPE, {
  factory: () => {
    const env = readEnvFile(['CONSOLE_PORT', ...ONECLI_KEYS]);
    // The OneCLI gateway reads these from the service environment before .env.
    for (const key of ONECLI_KEYS) if (process.env[key]) env[key] = process.env[key];
    return consoleAdapterFromEnv({ ...env, NANOCLAW_GATEWAY_PROVIDER: selectedGatewayKind() });
  },
  defaults: CONSOLE_DEFAULTS,
});

function selectedGatewayKind(): string | undefined {
  try {
    return configuredGatewayProviderKind();
  } catch {
    return undefined;
  }
}
