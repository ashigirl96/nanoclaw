import { randomUUID } from 'crypto';

import { TEMPLATES_DIR } from '../../config.js';
import {
  createPendingApproval,
  deletePendingApproval,
  getPendingApproval,
  transitionPendingApprovalStatus,
} from '../../db/sessions.js';
import { getDeliveryAdapter } from '../../delivery.js';
import { ALLOW, DENY, HOLD, defineGuardedAction, guard, type GuardActor } from '../../guard/index.js';
import { log } from '../../log.js';
import { pickApprovalDelivery, pickApprover } from '../../modules/approvals/primitive.js';
import { isAuthorizedApprovalClick } from '../../modules/approvals/response-handler.js';
import { isGlobalAdmin, isOwner } from '../../modules/permissions/db/user-roles.js';
import { registerResponseHandler, type ResponsePayload } from '../../response-registry.js';
import { createAgentFromTemplate } from '../../templates/create-agent.js';
import type { PendingApproval } from '../../types.js';
import { hasLocalTemplate, listTemplatesFromDir, templateDescription } from '../../templates/library.js';
import { isValidTemplateRef } from '../../templates/local-dir.js';
import { normalizeOptions, type RawOption } from '../ask-question.js';
import { CHANNEL_TYPE, OWNER_USER_ID } from './chat.js';

export const CONSOLE_CREATE_AGENT = 'console_create_agent';

interface CreateRequest {
  template: string;
  name: string | null;
}

export class CreateAgentRequestError extends Error {}

export type CreateAgentOutcome =
  | { status: 'created'; agentGroup: { id: string; name: string } }
  | { status: 'held' }
  | { status: 'denied'; reason: string };

export const consoleAgentsCreate = defineGuardedAction({
  action: 'console.agents.create',
  grantActionName: CONSOLE_CREATE_AGENT,
  grantCoversRequest: (grant, input) => {
    const approved = JSON.parse(grant.payload) as Partial<CreateRequest>;
    return approved.template === input.payload.template && (approved.name ?? null) === input.payload.name;
  },
  decide: async ({ actor }) => {
    if (actor.kind !== 'human') return DENY('the Console creates Agent Groups only for a person');
    if ((await isOwner(actor.userId)) || (await isGlobalAdmin(actor.userId))) return ALLOW('Owner or global admin');
    return HOLD(`${actor.userId} needs an Owner or global admin to create an Agent Group`);
  },
});

const APPROVAL_OPTIONS: RawOption[] = [
  { label: 'Approve', selectedLabel: '✅ Approved', value: 'approve', style: 'primary' },
  { label: 'Reject', selectedLabel: '❌ Rejected', value: 'reject', style: 'danger' },
];

const changeListeners = new Set<() => void>();

/** Called whenever "+" adds an Agent Group, including after an approval. */
export function onAgentGroupsChanged(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

export function listConsoleTemplates(): Array<{ ref: string; name: string; description: string }> {
  return listTemplatesFromDir(TEMPLATES_DIR)
    .filter((t) => isValidTemplateRef(t.ref))
    .map((t) => ({ ref: t.ref, name: t.name, description: templateDescription(t.ref) ?? '' }));
}

export async function createAgentFromConsole(body: Record<string, unknown>): Promise<CreateAgentOutcome> {
  const request = parseRequest(body);
  const actor: GuardActor = { kind: 'human', userId: OWNER_USER_ID };
  const decision = await guard(consoleAgentsCreate, { actor, payload: { ...request } });
  if (decision.effect === 'deny') return { status: 'denied', reason: decision.reason };
  if (decision.effect === 'hold') {
    await requestApproval(request);
    return { status: 'held' };
  }
  return { status: 'created', agentGroup: await stamp(request) };
}

function parseRequest(body: Record<string, unknown>): CreateRequest {
  const template = typeof body.template === 'string' ? body.template : '';
  if (!isValidTemplateRef(template) || !hasLocalTemplate(template)) {
    throw new CreateAgentRequestError(`no Template "${template}" on this machine`);
  }
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : null;
  return { template, name };
}

async function stamp(request: CreateRequest): Promise<{ id: string; name: string }> {
  const { group } = await createAgentFromTemplate(request.template, { name: request.name ?? undefined });
  log.info('Console created an Agent Group', { agentGroupId: group.id, template: request.template });
  for (const listener of changeListeners) listener();
  return { id: group.id, name: group.name };
}

async function requestApproval(request: CreateRequest): Promise<void> {
  const target = await pickApprovalDelivery(await pickApprover(null), CHANNEL_TYPE);
  if (!target) throw new Error('no Owner or admin can be reached to approve creating an Agent Group');
  const adapter = getDeliveryAdapter();
  if (!adapter) throw new Error('delivery is not running, so the Approval Request cannot be sent');

  const approvalId = `appr-console-${randomUUID()}`;
  const title = 'Create an Agent Group';
  const question = `The Console asks to create the Agent Group "${request.name ?? request.template}" from the Template ${request.template}.`;
  const mg = target.messagingGroup;
  await createPendingApproval({
    approval_id: approvalId,
    session_id: null,
    request_id: approvalId,
    action: CONSOLE_CREATE_AGENT,
    payload: JSON.stringify(request),
    created_at: new Date().toISOString(),
    channel_type: mg.channel_type,
    platform_id: mg.platform_id,
    instance: mg.instance ?? null,
    title,
    question,
    options_json: JSON.stringify(normalizeOptions(APPROVAL_OPTIONS)),
    approver_user_id: target.userId,
  });
  try {
    await adapter.deliver(
      mg.channel_type,
      mg.platform_id,
      null,
      'chat-sdk',
      JSON.stringify({ type: 'ask_question', questionId: approvalId, title, question, options: APPROVAL_OPTIONS }),
      undefined,
      mg.instance ?? undefined,
    );
  } catch (err) {
    await deletePendingApproval(approvalId);
    throw err;
  }
  log.info('Console asked for approval to create an Agent Group', { approvalId, approver: target.userId });
}

async function handleApprovalPress(payload: ResponsePayload): Promise<boolean> {
  const approval = await getPendingApproval(payload.questionId);
  if (!approval || approval.action !== CONSOLE_CREATE_AGENT) return false;
  if (!(await isAuthorizedApprovalClick(approval, payload))) {
    log.warn('Ignoring a press on a Console Approval Request from someone else', {
      approvalId: approval.approval_id,
      userId: payload.userId,
    });
    return true;
  }

  try {
    if (
      payload.value === 'approve' &&
      (await transitionPendingApprovalStatus(approval.approval_id, 'pending', 'approved'))
    ) {
      await replayApproved(approval);
    }
  } finally {
    await deletePendingApproval(approval.approval_id);
  }
  return true;
}

async function replayApproved(approval: PendingApproval): Promise<void> {
  const request = JSON.parse(approval.payload) as CreateRequest;
  const decision = await guard(consoleAgentsCreate, {
    actor: { kind: 'human', userId: OWNER_USER_ID },
    payload: { ...request },
    grant: approval,
  });
  if (decision.effect !== 'allow') {
    log.warn('Guard refused the approved Console Agent Group creation', { reason: decision.reason });
    return;
  }
  await stamp(request);
}

// Ahead of the core approvals handler, which drops any approval that has no Session; "+" has none.
registerResponseHandler(handleApprovalPress, { prepend: true });
