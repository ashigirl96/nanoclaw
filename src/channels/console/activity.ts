import { getMessagingGroupByPlatform } from '../../db/messaging-groups.js';
import { findSessionByAgentGroup, findSessionForAgent } from '../../db/sessions.js';
import type { MailboxSession } from '../../mailbox/index.js';
import { withExistingMailboxSession } from '../../session-manager.js';
import { CHANNEL_TYPE } from './chat.js';

export interface Activity {
  working: boolean;
  tool: string | null;
}

export const IDLE: Activity = { working: false, tool: null };

// The typing module re-fires setTyping every 4s while the Agent works, so two missed ticks mean it stopped.
const WORKING_TTL_MS = 9000;
// The typing module skips setTyping for 10s after each delivery, and its next tick can come up to 4s after that.
const DELIVERY_HOLD_MS = 15_000;

interface Entry {
  activity: Activity;
  timer: NodeJS.Timeout;
}

export class ActivityBoard {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly onChange: (agentGroupId: string, activity: Activity) => void) {}

  get(agentGroupId: string): Activity {
    return this.entries.get(agentGroupId)?.activity ?? IDLE;
  }

  touch(agentGroupId: string, tool: string | null): void {
    const previous = this.entries.get(agentGroupId);
    if (previous) clearTimeout(previous.timer);
    const activity = { working: true, tool };
    this.entries.set(agentGroupId, { activity, timer: this.expireAfter(agentGroupId, WORKING_TTL_MS) });
    if (!previous || previous.activity.tool !== tool) this.onChange(agentGroupId, activity);
  }

  holdThroughDelivery(agentGroupId: string): void {
    const entry = this.entries.get(agentGroupId);
    if (!entry) return;
    clearTimeout(entry.timer);
    entry.timer = this.expireAfter(agentGroupId, DELIVERY_HOLD_MS);
  }

  private expireAfter(agentGroupId: string, ms: number): NodeJS.Timeout {
    const timer = setTimeout(() => this.clear(agentGroupId), ms);
    timer.unref();
    return timer;
  }

  clear(agentGroupId: string): void {
    const entry = this.entries.get(agentGroupId);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.entries.delete(agentGroupId);
    this.onChange(agentGroupId, IDLE);
  }

  dispose(): void {
    for (const entry of this.entries.values()) clearTimeout(entry.timer);
    this.entries.clear();
  }
}

export async function currentToolOf(agentGroupId: string, platformId: string): Promise<string | null> {
  return (await readChatSession(agentGroupId, platformId, (m) => m.getContainerState()?.currentTool)) ?? null;
}

export async function isMidTurn(agentGroupId: string, platformId: string): Promise<boolean> {
  return (await readChatSession(agentGroupId, platformId, (m) => m.getProcessingClaims().length > 0)) ?? false;
}

async function readChatSession<T>(
  agentGroupId: string,
  platformId: string,
  read: (mailbox: MailboxSession) => T,
): Promise<T | undefined> {
  const mg = await getMessagingGroupByPlatform(CHANNEL_TYPE, platformId);
  const session =
    (mg && (await findSessionForAgent(agentGroupId, mg.id, null))) ?? (await findSessionByAgentGroup(agentGroupId));
  if (!session) return undefined;
  return withExistingMailboxSession(agentGroupId, session.id, read);
}
