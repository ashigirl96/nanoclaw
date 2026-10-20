/**
 * Form-encoded drop-ins for the slack-lib calls that hit Slack's read methods.
 * Those methods ignore a JSON body and answer `invalid_arguments`, but
 * slack-lib.ts sends every method as JSON and is overwritten by each skill
 * refresh, so callers import these instead.
 */
import { SlackApiError, slackCall as slackJsonCall } from './slack-lib.js';

const SLACK_API = 'https://slack.com/api';
const FORM_ONLY_METHODS = new Set(['conversations.members', 'conversations.info', 'users.info']);

/** slack-lib's slackCall, except read methods go out form-encoded. */
export async function slackCall(
  token: string,
  method: string,
  body: Record<string, unknown>,
  step: string,
): Promise<Record<string, unknown>> {
  if (!FORM_ONLY_METHODS.has(method)) return slackJsonCall(token, method, body, step);

  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) {
    if (value !== undefined) form.set(key, String(value));
  }
  let res: Response;
  try {
    res = await fetch(`${SLACK_API}/${method}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw new SlackApiError(step, `slack ${method} failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  let json: Record<string, unknown>;
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    throw new SlackApiError(step, `slack ${method} failed: HTTP ${res.status}, non-JSON body`);
  }
  if (json.ok !== true) {
    throw new SlackApiError(step, `slack ${method} failed: ${String(json.error ?? `HTTP ${res.status}`)}`);
  }
  return json;
}

/** slack-lib's slackConversationsInfo over the form-encoded call. */
export async function slackConversationsInfo(
  token: string,
  channelId: string,
  step: string,
): Promise<{ isMpim: boolean; name?: string; creator?: string }> {
  const json = await slackCall(token, 'conversations.info', { channel: channelId }, step);
  const channel = json.channel as Record<string, unknown> | undefined;
  return {
    isMpim: channel?.is_mpim === true,
    name: typeof channel?.name === 'string' ? channel.name : undefined,
    creator: typeof channel?.creator === 'string' ? channel.creator : undefined,
  };
}

/** slack-lib's slackConversationsMembers over the form-encoded call; the page cap matches it. */
export async function slackConversationsMembers(token: string, channelId: string, step: string): Promise<string[]> {
  const members: string[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 10; page++) {
    const json = await slackCall(
      token,
      'conversations.members',
      { channel: channelId, limit: 200, ...(cursor ? { cursor } : {}) },
      step,
    );
    for (const m of (json.members as unknown[] | undefined) ?? []) {
      if (typeof m === 'string') members.push(m);
    }
    const meta = json.response_metadata as { next_cursor?: string } | undefined;
    cursor = meta?.next_cursor || undefined;
    if (!cursor) break;
  }
  return members;
}
