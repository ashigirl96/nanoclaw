import { getMessagingGroupAgentByPair, getMessagingGroupsByAgentGroup } from '../../db/messaging-groups.js';
import { readEnvFile } from '../../env.js';
import { log } from '../../log.js';
import { botTokenKeyForInstance, slackAuthTest } from '../slack-lib.js';
import { toAvatarImage } from './avatar-image.js';
import type { ConsoleStore, Image } from './store.js';

const SLACK_API = 'https://slack.com/api';
const CLASSIC_INSTANCE = 'slack';

export class NoOwnSlackBotError extends Error {
  constructor(agentGroupId: string) {
    super(`${agentGroupId} has no Slack bot of its own`);
  }
}

export interface SlackAvatars {
  /**
   * Fetches, in the background, the Avatar of each listed Agent Group that has none cached. An Agent Group
   * with its own Slack bot is tried once per Host run; one without is checked again on the next list.
   */
  warm(agentGroupIds: string[]): void;
  refresh(agentGroupId: string): Promise<void>;
}

export function createSlackAvatars(store: ConsoleStore, onChange: () => void): SlackAvatars {
  const attempted = new Set<string>();

  async function refresh(agentGroupId: string): Promise<void> {
    const instance = await ownSlackInstanceOf(agentGroupId);
    if (!instance) throw new NoOwnSlackBotError(agentGroupId);
    store.setAvatar(agentGroupId, 'slack', await fetchBotImage(instance));
    onChange();
  }

  return {
    warm(agentGroupIds) {
      for (const id of agentGroupIds) {
        if (attempted.has(id) || store.getAppearance(id).hasSlackAvatar) continue;
        attempted.add(id);
        refresh(id).catch((err) => {
          if (err instanceof NoOwnSlackBotError) return attempted.delete(id);
          log.warn('Console could not fetch the Slack bot image for an Avatar', { agentGroupId: id, err });
        });
      }
    },
    refresh,
  };
}

export async function hasOwnSlackBot(agentGroupId: string): Promise<boolean> {
  return (await ownSlackInstanceOf(agentGroupId)) !== null;
}

/** The dedicated Slack instance of the Agent Group's oldest Slack Wiring; the classic shared bot does not count. */
async function ownSlackInstanceOf(agentGroupId: string): Promise<string | null> {
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
  return wired[0]?.instance ?? null;
}

async function fetchBotImage(instance: string): Promise<Image> {
  const tokenKey = botTokenKeyForInstance(instance);
  const token = readEnvFile([tokenKey])[tokenKey];
  if (!token) throw new Error(`${tokenKey} is not set in .env`);
  const { userId } = await slackAuthTest(token, 'console-avatar');
  const info = await usersInfo(token, userId);
  const profile = (info.user as { profile?: Record<string, unknown> } | undefined)?.profile ?? {};
  const url = [profile.image_512, profile.image_192, profile.image_72].find((u) => typeof u === 'string');
  if (typeof url !== 'string') throw new Error('slack users.info returned no profile image');
  return downloadImage(url);
}

// users.info ignores JSON arguments, so it goes form-encoded instead of through slackCall.
async function usersInfo(token: string, user: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${SLACK_API}/users.info`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ user }).toString(),
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (json.ok !== true) throw new Error(`slack users.info failed: ${String(json.error ?? `HTTP ${res.status}`)}`);
  return json;
}

async function downloadImage(url: string): Promise<Image> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Slack bot image download failed: HTTP ${res.status}`);
  return toAvatarImage(Buffer.from(await res.arrayBuffer()));
}
