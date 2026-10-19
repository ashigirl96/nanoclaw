import { findTaskSessions } from '../../db/sessions.js';
import { parseTaskContent } from '../../modules/scheduling/task-content.js';
import { readRunLogTail } from '../../modules/scheduling/run-log.js';
import { withExistingMailboxSession } from '../../session-manager.js';

export interface TaskSummary {
  taskId: string;
  prompt: string;
  status: 'pending' | 'paused';
  /** The cron expression, or `once`. */
  schedule: string;
  nextOccurrence: string | null;
  lastOccurrence: string | null;
  occurrences: number;
  failedOccurrences: number;
  lastResult: string | null;
}

export async function listTasks(agentGroupId: string): Promise<TaskSummary[]> {
  const tasks: TaskSummary[] = [];
  for (const session of await findTaskSessions(agentGroupId, false)) {
    const rows = await withExistingMailboxSession(session.agent_group_id, session.id, (mailbox) =>
      mailbox.listLiveTasks().map((row) => {
        const taskId = row.seriesId ?? row.id;
        const stats = mailbox.getTaskStats(taskId);
        return {
          taskId,
          prompt: parseTaskContent(row.content).prompt,
          status: row.status as TaskSummary['status'],
          schedule: row.recurrence ?? 'once',
          nextOccurrence: row.processAfter,
          lastOccurrence: stats.lastRun,
          occurrences: stats.runs,
          failedOccurrences: stats.failedRuns,
        };
      }),
    );
    for (const row of rows ?? []) {
      const log = await readRunLogTail(agentGroupId, row.taskId, 1);
      tasks.push({ ...row, lastResult: log[0] ?? null });
    }
  }
  return tasks.sort((a, b) => compareSoonestFirst(a.nextOccurrence, b.nextOccurrence));
}

function compareSoonestFirst(a: string | null, b: string | null): number {
  if (a === null || b === null) return Number(a === null) - Number(b === null);
  return a.localeCompare(b);
}
