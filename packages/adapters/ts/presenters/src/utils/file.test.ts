import { describe, expect, it } from 'bun:test';

import { formatFileSize } from './file';

describe('formatFileSize', () => {
  it('formats byte counts for display', () => {
    expect(formatFileSize(0)).toBe('0 Bytes');
    expect(formatFileSize(2048)).toBe('2 KB');
  });
});
