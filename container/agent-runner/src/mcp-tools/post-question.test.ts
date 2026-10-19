import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { closeSessionDb, getInboundDb, initTestSessionDb } from '../mailbox/sqlite/connection.js';
import { getUndeliveredMessages } from '../db/messages-out.js';
import { postQuestion } from './post-question.js';

beforeEach(() => initTestSessionDb());
afterEach(() => closeSessionDb());

function bindSession(channelType: string, platformId: string): void {
  const db = getInboundDb();
  db.exec(`CREATE TABLE IF NOT EXISTS session_routing (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    channel_type TEXT, platform_id TEXT, thread_id TEXT
  )`);
  db.prepare('INSERT INTO session_routing (id, channel_type, platform_id, thread_id) VALUES (1, ?, ?, NULL)').run(
    channelType,
    platformId,
  );
}

function written() {
  const [row] = getUndeliveredMessages();
  return { ...row, content: JSON.parse(row.content) };
}

describe('post_question in a Console session', () => {
  beforeEach(() => bindSession('web', 'web:ag-a'));

  it('posts a Question with options and returns without waiting for the answer', async () => {
    const result = await postQuestion.handler({
      title: 'Lunch',
      question: 'Where should we eat?',
      options: ['Sushi', { label: 'Ramen', value: 'ramen' }],
    });

    expect(result.isError).not.toBe(true);
    expect(result.content[0].text).toContain('「Lunch — Where should we eat?」への答え');
    const row = written();
    expect(row).toMatchObject({ kind: 'chat-sdk', channel_type: 'web', platform_id: 'web:ag-a' });
    expect(row.content).toMatchObject({
      type: 'post_question',
      title: 'Lunch',
      question: 'Where should we eat?',
      options: [
        { label: 'Sushi', selectedLabel: 'Sushi', value: 'Sushi' },
        { label: 'Ramen', selectedLabel: 'Ramen', value: 'ramen' },
      ],
    });
    expect(typeof row.content.questionId).toBe('string');
  });

  it('posts a form with its fields', async () => {
    const fields = [
      { id: 'name', label: 'Name', type: 'text' },
      { id: 'notes', label: 'Notes', type: 'textarea' },
      { id: 'size', label: 'Size', type: 'select', options: ['S', 'M', 'L'] },
      { id: 'toppings', label: 'Toppings', type: 'multi_select', options: ['Egg', 'Nori'] },
      { id: 'when', label: 'When', type: 'date' },
    ];
    const result = await postQuestion.handler({ title: 'Order', question: 'What do you want?', fields });

    expect(result.isError).not.toBe(true);
    expect(written().content).toMatchObject({ type: 'post_question', title: 'Order', fields });
  });

  it.each([
    ['neither options nor fields', {}],
    ['both options and fields', { options: ['A'], fields: [{ id: 'a', label: 'A', type: 'text' }] }],
    ['an unknown field type', { fields: [{ id: 'a', label: 'A', type: 'color' }] }],
    ['a select field without options', { fields: [{ id: 'a', label: 'A', type: 'select' }] }],
    [
      'two fields with the same id',
      {
        fields: [
          { id: 'a', label: 'A', type: 'text' },
          { id: 'a', label: 'B', type: 'text' },
        ],
      },
    ],
  ])('refuses %s', async (_name, extra) => {
    const result = await postQuestion.handler({ title: 'T', question: 'Q', ...extra });

    expect(result.isError).toBe(true);
    expect(getUndeliveredMessages()).toHaveLength(0);
  });
});

describe('post_question outside the Console', () => {
  beforeEach(() => bindSession('slack', 'slack:C1'));

  it('sends the options as lettered lines of text', async () => {
    const result = await postQuestion.handler({
      title: 'Lunch',
      question: 'Where should we eat?',
      options: ['Sushi', 'Ramen'],
    });

    expect(result.isError).not.toBe(true);
    const row = written();
    expect(row).toMatchObject({ kind: 'chat', channel_type: 'slack', platform_id: 'slack:C1' });
    expect(row.content.text).toBe('*Lunch*\nWhere should we eat?\n\nA. Sushi\nB. Ramen');
  });

  it('sends a form as a list of the fields to fill in', async () => {
    await postQuestion.handler({
      title: 'Order',
      question: 'What do you want?',
      fields: [
        { id: 'name', label: 'Name', type: 'text' },
        { id: 'size', label: 'Size', type: 'select', options: ['S', 'M'] },
        { id: 'toppings', label: 'Toppings', type: 'multi_select', options: ['Egg', 'Nori'] },
        { id: 'when', label: 'When', type: 'date' },
      ],
    });

    expect(written().content.text).toBe(
      '*Order*\nWhat do you want?\n\n' +
        '- Name\n' +
        '- Size (one of: S / M)\n' +
        '- Toppings (any of: Egg / Nori)\n' +
        '- When (date, YYYY-MM-DD)',
    );
  });
});
