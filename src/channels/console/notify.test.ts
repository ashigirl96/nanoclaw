import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type Harness, startConsole, stopConsole } from './test-harness.js';

let h: Harness;

beforeEach(async () => {
  h = await startConsole();
});

afterEach(async () => {
  await stopConsole();
});

const question = {
  type: 'ask_question',
  questionId: 'q-1',
  title: 'Deploy',
  question: 'Deploy to production?',
  options: [{ label: 'Yes', selectedLabel: 'Yes', value: 'yes' }],
};

describe('notifications', () => {
  it('announces a reply with its text', async () => {
    const events = await h.openEvents();

    await h.adapter.deliver('web:ag-a', null, { kind: 'chat', content: { text: 'All done' } });

    expect(await events.ofType('notify', 1)).toEqual([
      { type: 'notify', kind: 'reply', chatId: 'ag:ag-a', agentGroupId: 'ag-a', body: 'All done' },
    ]);
    events.close();
  });

  it('announces a Question the Agent asks in its Chat', async () => {
    const events = await h.openEvents();

    await h.adapter.deliver('web:ag-a', null, { kind: 'chat-sdk', content: question });

    expect(await events.ofType('notify', 1)).toEqual([
      { type: 'notify', kind: 'question', chatId: 'ag:ag-a', agentGroupId: 'ag-a', body: 'Deploy to production?' },
    ]);
    events.close();
  });

  it('announces an Approval Request sent to the Owner rather than to an Agent Group Chat', async () => {
    const events = await h.openEvents();

    await h.adapter.deliver('owner', null, {
      kind: 'chat-sdk',
      content: { ...question, title: 'Install packages', question: 'Alice wants to install jq' },
    });

    expect(await events.ofType('notify', 1)).toEqual([
      { type: 'notify', kind: 'approval', chatId: 'inbox', agentGroupId: null, body: 'Alice wants to install jq' },
    ]);
    events.close();
  });

  it('stays quiet for a message it drops because no Chat has its platform id', async () => {
    const events = await h.openEvents();

    await h.adapter.deliver('elsewhere', null, { kind: 'chat-sdk', content: question });
    await h.adapter.deliver('web:ag-a', null, { kind: 'chat', content: { text: 'next' } });

    expect(await events.ofType('notify', 1)).toEqual([
      { type: 'notify', kind: 'reply', chatId: 'ag:ag-a', agentGroupId: 'ag-a', body: 'next' },
    ]);
    events.close();
  });

  it('stays quiet for edits and reactions', async () => {
    const id = await h.adapter.deliver('web:ag-a', null, { kind: 'chat', content: { text: 'draft' } });
    const events = await h.openEvents();

    await h.adapter.deliver('web:ag-a', null, {
      kind: 'chat',
      content: { operation: 'edit', messageId: id, text: 'x' },
    });
    await h.adapter.deliver('web:ag-a', null, {
      kind: 'chat',
      content: { operation: 'reaction', messageId: id, emoji: 'eyes' },
    });
    await h.adapter.deliver('web:ag-a', null, { kind: 'chat', content: { text: 'next' } });

    expect(await events.ofType('notify', 1)).toEqual([
      { type: 'notify', kind: 'reply', chatId: 'ag:ag-a', agentGroupId: 'ag-a', body: 'next' },
    ]);
    events.close();
  });
});
