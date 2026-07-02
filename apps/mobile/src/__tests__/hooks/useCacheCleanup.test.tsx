import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { renderHook, waitFor } from '@testing-library/react-native';
import * as FileSystem from '../../utils/file-system';

import { useCacheCleanup } from '../../hooks/useCacheCleanup';

jest.mock('../../utils/file-system', () => ({
  cacheDirectory: 'file:///mock-cache/',
  readDirectoryAsync: jest.fn(),
  getInfoAsync: jest.fn(),
  deleteAsync: jest.fn(),
}));

jest.mock('../../logger', () => ({
  createModuleLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

describe('useCacheCleanup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    (FileSystem.readDirectoryAsync as jest.Mock).mockResolvedValue([]);
    (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({
      exists: true,
      isDirectory: false,
      modificationTime: 1_699_999_000,
    });
    (FileSystem.deleteAsync as jest.Mock).mockResolvedValue(undefined);
  });

  it('deletes only stale attachment-like files older than 24 hours', async () => {
    (FileSystem.readDirectoryAsync as jest.Mock).mockResolvedValue([
      'stale.jpg',
      'fresh.jpg',
      'exact24h.png',
      'DocumentPicker-old-cache',
      'ImagePicker-directory',
      'notes.txt',
    ]);

    const nowSeconds = 1_700_000_000;
    const fileInfoByUri: Record<string, { exists: boolean; isDirectory: boolean; modificationTime: number }> = {
      'file:///mock-cache/stale.jpg': {
        exists: true,
        isDirectory: false,
        modificationTime: nowSeconds - (24 * 60 * 60 + 30),
      },
      'file:///mock-cache/fresh.jpg': {
        exists: true,
        isDirectory: false,
        modificationTime: nowSeconds - 300,
      },
      'file:///mock-cache/exact24h.png': {
        exists: true,
        isDirectory: false,
        modificationTime: nowSeconds - 24 * 60 * 60,
      },
      'file:///mock-cache/DocumentPicker-old-cache': {
        exists: true,
        isDirectory: false,
        modificationTime: nowSeconds - (24 * 60 * 60 + 120),
      },
      'file:///mock-cache/ImagePicker-directory': {
        exists: true,
        isDirectory: true,
        modificationTime: nowSeconds - (24 * 60 * 60 + 120),
      },
    };

    (FileSystem.getInfoAsync as jest.Mock).mockImplementation(async (uri: string) => {
      const info = fileInfoByUri[uri];
      if (!info) {
        throw new Error(`Unexpected file uri in test: ${uri}`);
      }
      return info;
    });

    renderHook(() => useCacheCleanup());

    await waitFor(() => {
      expect(FileSystem.deleteAsync).toHaveBeenCalledTimes(2);
    });

    expect(FileSystem.deleteAsync).toHaveBeenCalledWith('file:///mock-cache/stale.jpg', {
      idempotent: true,
    });
    expect(FileSystem.deleteAsync).toHaveBeenCalledWith(
      'file:///mock-cache/DocumentPicker-old-cache',
      {
        idempotent: true,
      }
    );
    expect(FileSystem.getInfoAsync).not.toHaveBeenCalledWith('file:///mock-cache/notes.txt');
    expect(FileSystem.deleteAsync).not.toHaveBeenCalledWith('file:///mock-cache/exact24h.png', {
      idempotent: true,
    });
  });

  it('recurses into picker cache directories', async () => {
    (FileSystem.readDirectoryAsync as jest.Mock).mockImplementation(async (uri: string) => {
      if (uri === 'file:///mock-cache/') return ['DocumentPicker', 'ImagePicker'];
      if (uri === 'file:///mock-cache/DocumentPicker/') return ['old.pdf', 'notes.txt'];
      if (uri === 'file:///mock-cache/ImagePicker/') return ['old.jpg'];
      throw new Error(`Unexpected directory uri in test: ${uri}`);
    });
    (FileSystem.getInfoAsync as jest.Mock).mockImplementation(async (uri: string) => {
      if (uri === 'file:///mock-cache/DocumentPicker' || uri === 'file:///mock-cache/ImagePicker') {
        return { exists: true, isDirectory: true, modificationTime: 1_699_900_000 };
      }
      return { exists: true, isDirectory: false, modificationTime: 1_699_900_000 };
    });

    renderHook(() => useCacheCleanup());

    await waitFor(() => {
      expect(FileSystem.deleteAsync).toHaveBeenCalledTimes(2);
    });

    expect(FileSystem.deleteAsync).toHaveBeenCalledWith(
      'file:///mock-cache/DocumentPicker/old.pdf',
      { idempotent: true }
    );
    expect(FileSystem.deleteAsync).toHaveBeenCalledWith(
      'file:///mock-cache/ImagePicker/old.jpg',
      { idempotent: true }
    );
  });

  it('does not inspect or delete non-target cache entries', async () => {
    (FileSystem.readDirectoryAsync as jest.Mock).mockResolvedValue([
      'session.db',
      'app-state.json',
      'build-manifest.bin',
    ]);

    renderHook(() => useCacheCleanup());

    await waitFor(() => {
      expect(FileSystem.readDirectoryAsync).toHaveBeenCalledTimes(1);
    });

    expect(FileSystem.getInfoAsync).not.toHaveBeenCalled();
    expect(FileSystem.deleteAsync).not.toHaveBeenCalled();
  });
});
