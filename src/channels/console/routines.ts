import { findTaskSessions } from '../../db/sessions.js';
import { parseTaskContent } from '../../modules/scheduling/task-content.js';
import { readRunLogTail } from '../../modules/scheduling/run-log.js';
import { withExistingMailboxSession } from '../../session-manager.js';

export interface Routine {
  seriesId: string;
  prompt: string;
  status: 'pending' | 'paused';
  /** The cron expression, or `once`. */
  schedule: string;
  nextRun: string;
  lastRun: string | null;
  runs: number;
  failedRuns: number;
  /** The newest line of the Agent's run log for this Task. */
  lastResult: string | null;
}

/** The Agent Group's live Tasks, read-only, soonest first — the same rows `ncl tasks list` reads. */
export async function listRoutines(agentGroupId: string): Promise<Routine[]> {
  const routines: Routine[] = [];
  for (const session of await findTaskSessions(agentGroupId, false)) {
    const rows = await withExistingMailboxSession(session.agent_group_id, session.id, (mailbox) =>
      mailbox.listLiveTasks().map((row) => {
        const seriesId = row.seriesId ?? row.id;
        const stats = mailbox.getTaskStats(seriesId);
        return {
          seriesId,
          prompt: parseTaskContent(row.content).prompt,
          status: row.status as Routine['status'],
          schedule: row.recurrence ?? 'once',
          nextRun: row.processAfter,
          lastRun: stats.lastRun,
          runs: stats.runs,
          failedRuns: stats.failedRuns,
        };
      }),
    );
    for (const row of rows ?? []) {
      const log = await readRunLogTail(agentGroupId, row.seriesId, 1);
      routines.push({ ...row, lastResult: log[0] ?? null });
    }
  }
  return routines.sort((a, b) => a.nextRun.localeCompare(b.nextRun));
}
