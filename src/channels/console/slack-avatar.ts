import { getMessagingGroupAgentByPair, getMessagingGroupsByAgentGroup } from '../../db/messaging-groups.js';
import { readEnvFile } from '../../env.js';
import { log } from '../../log.js';
import { toAvatarImage } from './avatar-image.js';
import type { ConsoleStore, Image } from './store.js';

// The Console does not import the Slack channel, which an install may not have or may remove.
const SLACK_API = 'https://slack.com/api';
const CLASSIC_INSTANCE = 'slack';

export class NoOwnSlackBotError extends Error {
  constructor(agentGroupId: string) {
    super(`${agentGroupId} has no Slack bot of its own`);
  }
}

export interface SlackAvatars {
  /**
   * Brings the cached Slack Avatar of each listed Agent Group in line with its Slack bot, in the background:
   * fetches it when missing and drops it once the bot is gone. An Agent Group with its own Slack bot is
   * checked once per Host run; one without is checked again on the next list.
   */
  warm(agentGroupIds: string[]): void;
  refresh(agentGroupId: string): Promise<void>;
}

export function createSlackAvatars(store: ConsoleStore, onChange: () => void): SlackAvatars {
  const checked = new Set<string>();

  async function refresh(agentGroupId: string): Promise<void> {
    const token = await ownSlackBotTokenOf(agentGroupId);
    if (!token) throw new NoOwnSlackBotError(agentGroupId);
    store.setAvatar(agentGroupId, 'slack', await fetchBotImage(token));
    onChange();
  }

  async function warmOne(agentGroupId: string): Promise<void> {
    const token = await ownSlackBotTokenOf(agentGroupId);
    const cached = store.getAppearance(agentGroupId).hasSlackAvatar;
    if (!token) {
      checked.delete(agentGroupId);
      if (!cached) return;
      store.setAvatar(agentGroupId, 'slack', null);
      return onChange();
    }
    if (cached) return;
    store.setAvatar(agentGroupId, 'slack', await fetchBotImage(token));
    onChange();
  }

  return {
    warm(agentGroupIds) {
      for (const id of agentGroupIds) {
        if (checked.has(id)) continue;
        checked.add(id);
        warmOne(id).catch((err) =>
          log.warn('Console could not fetch the Slack bot image for an Avatar', { agentGroupId: id, err }),
        );
      }
    },
    refresh,
  };
}

export async function hasOwnSlackBot(agentGroupId: string): Promise<boolean> {
  return (await ownSlackBotTokenOf(agentGroupId)) !== null;
}

/**
 * The bot token of the dedicated Slack instance on the Agent Group's oldest Slack Wiring. The classic shared bot
 * does not count, nor does an instance whose token is gone from .env, as after the Slack channel is removed.
 */
async function ownSlackBotTokenOf(agentGroupId: string): Promise<string | null> {
  const own = (await getMessagingGroupsByAgentGroup(agentGroupId)).filter(
    (mg) => mg.channel_type === 'slack' && mg.instance && mg.instance !== CLASSIC_INSTANCE,
  );
  const wired = await Promise.all(
    own.map(async (mg) => ({
      instance: mg.instance!,
      at: (await getMessagingGroupAgentByPair(mg.id, agentGroupId))?.created_at ?? '',
    })),
  );
  wired.sort((a, b) => a.at.localeCompare(b.at));
  if (!wired[0]) return null;
  const tokenKey = botTokenKeyOf(wired[0].instance);
  return readEnvFile([tokenKey])[tokenKey] || null;
}

async function fetchBotImage(token: string): Promise<Image> {
  const auth = await slackRead(token, 'auth.test', {});
  if (typeof auth.user_id !== 'string') throw new Error('slack auth.test failed: no user_id in response');
  const info = await slackRead(token, 'users.info', { user: auth.user_id });
  const profile = (info.user as { profile?: Record<string, unknown> } | undefined)?.profile ?? {};
  const url = [profile.image_512, profile.image_192, profile.image_72].find((u) => typeof u === 'string');
  if (typeof url !== 'string') throw new Error('slack users.info returned no profile image');
  return downloadImage(url);
}

/** The .env key the Slack channel reads a named instance's bot token from: `slack-my-bot` → `SLACK_BOT_TOKEN_MY_BOT`. */
function botTokenKeyOf(instance: string): string {
  return `SLACK_BOT_TOKEN_${instance
    .replace(/^slack-/, '')
    .toUpperCase()
    .replace(/-/g, '_')}`;
}

// Slack's read methods ignore JSON arguments, so these go form-encoded.
async function slackRead(token: string, method: string, params: Record<string, string>) {
  const res = await fetch(`${SLACK_API}/${method}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (json.ok !== true) throw new Error(`slack ${method} failed: ${String(json.error ?? `HTTP ${res.status}`)}`);
  return json;
}

async function downloadImage(url: string): Promise<Image> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Slack bot image download failed: HTTP ${res.status}`);
  return toAvatarImage(Buffer.from(await res.arrayBuffer()));
}
