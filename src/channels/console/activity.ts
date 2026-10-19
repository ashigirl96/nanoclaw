import { getMessagingGroupByPlatform } from '../../db/messaging-groups.js';
import { findSessionByAgentGroup, findSessionForAgent } from '../../db/sessions.js';
import { withExistingMailboxSession } from '../../session-manager.js';
import { CHANNEL_TYPE } from './chat.js';

export interface Activity {
  working: boolean;
  tool: string | null;
}

export const IDLE: Activity = { working: false, tool: null };

// The typing module re-fires setTyping every 4s while the Agent works, so two missed ticks mean it stopped.
const WORKING_TTL_MS = 9000;

interface Entry {
  activity: Activity;
  timer: NodeJS.Timeout;
}

/** Which Agent Groups are working right now, as seen through the Host's setTyping refresh. */
export class ActivityBoard {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly onChange: (agentGroupId: string, activity: Activity) => void,
    private readonly ttlMs = WORKING_TTL_MS,
  ) {}

  get(agentGroupId: string): Activity {
    return this.entries.get(agentGroupId)?.activity ?? IDLE;
  }

  touch(agentGroupId: string, tool: string | null): void {
    const previous = this.entries.get(agentGroupId);
    if (previous) clearTimeout(previous.timer);
    const timer = setTimeout(() => this.clear(agentGroupId), this.ttlMs);
    timer.unref();
    const activity = { working: true, tool };
    this.entries.set(agentGroupId, { activity, timer });
    if (!previous || previous.activity.tool !== tool) this.onChange(agentGroupId, activity);
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

/** The tool the Agent is running in the Console Chat's Session, read from the Session's container state. */
export async function currentToolOf(agentGroupId: string, platformId: string): Promise<string | null> {
  const mg = await getMessagingGroupByPlatform(CHANNEL_TYPE, platformId);
  const session =
    (mg && (await findSessionForAgent(agentGroupId, mg.id, null))) ?? (await findSessionByAgentGroup(agentGroupId));
  if (!session) return null;
  const tool = await withExistingMailboxSession(
    agentGroupId,
    session.id,
    (mailbox) => mailbox.getContainerState()?.currentTool ?? null,
  );
  return tool ?? null;
}
