import { describe, expect, it } from 'bun:test';

import { formatStorageBytes, formatStorageItemCount } from './format';

describe('storage formatting', () => {
  it('formats byte values with compact decimal units', () => {
    expect(formatStorageBytes(0)).toBe('0 B');
    expect(formatStorageBytes(Number.NaN)).toBe('0 B');
    expect(formatStorageBytes(999)).toBe('999 B');
    expect(formatStorageBytes(1500)).toBe('1.5 KB');
    expect(formatStorageBytes(2_500_000)).toBe('2.5 MB');
  });

  it('formats storage item counts by category', () => {
    expect(formatStorageItemCount('images', 1)).toBe('1 image');
    expect(formatStorageItemCount('images', 2)).toBe('2 images');
    expect(formatStorageItemCount('files', 1)).toBe('1 file');
    expect(formatStorageItemCount('files', 3)).toBe('3 files');
    expect(
      formatStorageItemCount('pending_uploads', 0, {
        pendingUploadLabel: 'reserved',
      })
    ).toBe('reserved');
  });
});
