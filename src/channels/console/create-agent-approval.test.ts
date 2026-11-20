import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeDb, initTestDb, runMigrations } from '../../db/index.js';
import { createPendingApproval, getPendingApproval } from '../../db/sessions.js';
import { dispatchResponse } from '../../response-registry.js';
import { CONSOLE_CREATE_AGENT } from './create-agent.js';

const APPROVAL_ID = 'appr-console-test';

function press(userId: string, value: string) {
  return dispatchResponse({
    questionId: APPROVAL_ID,
    value,
    userId,
    channelType: 'slack',
    platformId: 'D1',
    threadId: null,
  });
}

beforeEach(async () => {
  await runMigrations(await initTestDb());
  await createPendingApproval({
    approval_id: APPROVAL_ID,
    session_id: null,
    request_id: APPROVAL_ID,
    action: CONSOLE_CREATE_AGENT,
    payload: JSON.stringify({ template: 'basic', name: null }),
    created_at: new Date().toISOString(),
    channel_type: 'slack',
    platform_id: 'D1',
    instance: null,
    title: 'Create an Agent Group',
    question: 'q',
    options_json: '[]',
    approver_user_id: 'slack:U-OWNER',
  });
});

afterEach(async () => {
  await closeDb();
});

describe('Console create-agent approval press', () => {
  it('refuses a press from someone other than the approver and keeps the request', async () => {
    expect(await press('U-OTHER', 'approve')).toBe('refused');
    expect(await getPendingApproval(APPROVAL_ID)).toBeDefined();
  });

  it('accepts the approver rejecting and clears the request', async () => {
    expect(await press('U-OWNER', 'reject')).toBe('accepted');
    expect(await getPendingApproval(APPROVAL_ID)).toBeUndefined();
  });
});
