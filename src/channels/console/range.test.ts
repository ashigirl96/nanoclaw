import { describe, expect, it } from 'vitest';

import { parseByteRange } from './range.js';

describe('parseByteRange', () => {
  it.each([
    ['bytes=2-5', { start: 2, end: 5 }],
    ['bytes=7-', { start: 7, end: 9 }],
    ['bytes=-3', { start: 7, end: 9 }],
    ['bytes=-50', { start: 0, end: 9 }],
    ['bytes=2-999', { start: 2, end: 9 }],
    ['Bytes=0-0', { start: 0, end: 0 }],
  ])('reads %s of a 10-byte body', (header, range) => {
    expect(parseByteRange(header, 10)).toEqual(range);
  });

  it.each(['bytes=10-', 'bytes=-0'])('rejects %s of a 10-byte body as unsatisfiable', (header) => {
    expect(parseByteRange(header, 10)).toBe('unsatisfiable');
  });

  it.each(['bytes=0-', 'bytes=-5'])('rejects %s of an empty body as unsatisfiable', (header) => {
    expect(parseByteRange(header, 0)).toBe('unsatisfiable');
  });

  it.each([undefined, 'bytes=5-2', 'bytes=0-1,4-5', 'bytes=-', 'items=0-1'])(
    'serves the whole body for %s',
    (header) => {
      expect(parseByteRange(header, 10)).toBeNull();
    },
  );
});
