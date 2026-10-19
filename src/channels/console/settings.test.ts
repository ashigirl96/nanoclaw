import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config.js', async () => {
  const actual = await vi.importActual<typeof import('../../config.js')>('../../config.js');
  return { ...actual, TIMEZONE: 'Asia/Tokyo' };
});

import { type Harness, startConsole, stopConsole } from './test-harness.js';

let h: Harness;

beforeEach(async () => {
  h = await startConsole();
});

afterEach(async () => {
  await stopConsole();
});

describe('Console settings', () => {
  it('tells the browser the install timezone to show times in', async () => {
    expect(await h.api('/api/settings')).toEqual({ timezone: 'Asia/Tokyo', connectedAccounts: false });
  });
});
