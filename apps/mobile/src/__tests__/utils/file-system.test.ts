import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import {
  cacheDirectory,
  deleteAsync,
  downloadFileAsync,
  documentDirectory,
  EncodingType,
  getInfoAsync,
  readAsStringAsync,
  readDirectoryAsync,
  writeAsStringAsync,
  writeBytesAsync,
} from '../../utils/file-system';

type MockInfo = {
  exists: boolean;
  size?: number;
  modificationTime?: number;
  md5?: string;
  throwInfo?: boolean;
};

const mockFileInfos = new Map<string, MockInfo>();
const mockDirectoryInfos = new Map<string, MockInfo & { entries?: string[] }>();
const mockCreatedFiles: Array<{ uri: string; options: unknown }> = [];
const mockWrites: Array<{ uri: string; contents: string | Uint8Array; options?: unknown }> = [];
const mockDeletedFiles: string[] = [];
const mockDeletedDirectories: string[] = [];
const mockDownloads: Array<{ url: string; uri: string; options: unknown }> = [];

jest.mock('expo-file-system', () => {
  class MockFile {
    uri: string;

    constructor(uri: string) {
      this.uri = uri;
    }

    static async downloadFileAsync(url: string, destination: MockFile, options: unknown) {
      mockDownloads.push({ url, uri: destination.uri, options });
      return destination;
    }

    get exists() {
      return mockFileInfos.get(this.uri)?.exists ?? false;
    }

    info() {
      const info = mockFileInfos.get(this.uri);
      if (info?.throwInfo) {
        throw new Error('file info failed');
      }
      return info?.exists ? { ...info, uri: this.uri } : { exists: false, uri: this.uri };
    }

    create(options: unknown) {
      mockCreatedFiles.push({ uri: this.uri, options });
      mockFileInfos.set(this.uri, { exists: true });
    }

    write(contents: string | Uint8Array, options?: unknown) {
      mockWrites.push({ uri: this.uri, contents, options });
    }

    async base64() {
      return `base64:${this.uri}`;
    }

    async text() {
      return `text:${this.uri}`;
    }

    delete() {
      mockDeletedFiles.push(this.uri);
      mockFileInfos.set(this.uri, { exists: false });
    }
  }

  class MockDirectory {
    uri: string;

    constructor(uri: string) {
      this.uri = uri;
    }

    info() {
      const info = mockDirectoryInfos.get(this.uri);
      if (info?.throwInfo) {
        throw new Error('directory info failed');
      }
      return info?.exists ? { ...info, uri: this.uri } : { exists: false, uri: this.uri };
    }

    list() {
      return (mockDirectoryInfos.get(this.uri)?.entries ?? []).map((name) => ({ name }));
    }

    delete() {
      mockDeletedDirectories.push(this.uri);
      mockDirectoryInfos.set(this.uri, { exists: false });
    }
  }

  return {
    Directory: MockDirectory,
    File: MockFile,
    Paths: {
      cache: { uri: 'file:///cache/' },
      document: { uri: 'file:///documents/' },
    },
    EncodingType: { UTF8: 'utf8', Base64: 'base64' },
  };
});

describe('mobile file-system compatibility helpers', () => {
  beforeEach(() => {
    mockFileInfos.clear();
    mockDirectoryInfos.clear();
    mockCreatedFiles.length = 0;
    mockWrites.length = 0;
    mockDeletedFiles.length = 0;
    mockDeletedDirectories.length = 0;
    mockDownloads.length = 0;
  });

  it('exposes document and cache directory URIs from Expo Paths', () => {
    expect(documentDirectory).toBe('file:///documents/');
    expect(cacheDirectory).toBe('file:///cache/');
  });

  it('reads file metadata and converts modification times to seconds', async () => {
    mockFileInfos.set('file:///documents/a.txt', {
      exists: true,
      size: 12,
      modificationTime: 1_780_000_123_456,
      md5: 'hash',
    });

    await expect(getInfoAsync('file:///documents/a.txt', { md5: true })).resolves.toEqual({
      exists: true,
      uri: 'file:///documents/a.txt',
      size: 12,
      modificationTime: 1_780_000_123,
      md5: 'hash',
      isDirectory: false,
    });
  });

  it('falls back to directory metadata when file metadata is unavailable', async () => {
    mockFileInfos.set('file:///documents/folder', { exists: false, throwInfo: true });
    mockDirectoryInfos.set('file:///documents/folder', {
      exists: true,
      size: 3,
      modificationTime: 1_780_000_000_999,
    });

    await expect(getInfoAsync('file:///documents/folder')).resolves.toEqual({
      exists: true,
      uri: 'file:///documents/folder',
      size: 3,
      modificationTime: 1_780_000_000,
      isDirectory: true,
    });
  });

  it('reports inaccessible paths as missing and lists directory entry names', async () => {
    mockFileInfos.set('file:///missing', { exists: false, throwInfo: true });
    mockDirectoryInfos.set('file:///missing', { exists: false, throwInfo: true });
    mockDirectoryInfos.set('file:///documents', { exists: true, entries: ['a.txt', 'b.txt'] });

    await expect(getInfoAsync('file:///missing')).resolves.toEqual({
      exists: false,
      uri: 'file:///missing',
    });
    await expect(readDirectoryAsync('file:///documents')).resolves.toEqual(['a.txt', 'b.txt']);
  });

  it('creates missing files before writing strings or bytes', async () => {
    await writeAsStringAsync('file:///documents/a.txt', 'hello', { encoding: 'utf8' });
    await writeBytesAsync('file:///documents/b.bin', new Uint8Array([1, 2]));

    expect(mockCreatedFiles).toEqual([
      {
        uri: 'file:///documents/a.txt',
        options: { intermediates: true, overwrite: true },
      },
      {
        uri: 'file:///documents/b.bin',
        options: { intermediates: true, overwrite: true },
      },
    ]);
    expect(mockWrites).toEqual([
      {
        uri: 'file:///documents/a.txt',
        contents: 'hello',
        options: { encoding: 'utf8' },
      },
      {
        uri: 'file:///documents/b.bin',
        contents: new Uint8Array([1, 2]),
        options: undefined,
      },
    ]);
  });

  it('downloads files with transport options and reads text or base64 content', async () => {
    const onProgress = jest.fn();
    const controller = new AbortController();

    await downloadFileAsync('https://example.test/file', 'file:///documents/download.txt', {
      headers: { Authorization: 'Bearer token' },
      onProgress,
      signal: controller.signal,
    });

    expect(mockDownloads).toEqual([
      {
        url: 'https://example.test/file',
        uri: 'file:///documents/download.txt',
        options: {
          headers: { Authorization: 'Bearer token' },
          idempotent: true,
          onProgress,
          signal: controller.signal,
        },
      },
    ]);
    await expect(readAsStringAsync('file:///documents/download.txt')).resolves.toBe(
      'text:file:///documents/download.txt'
    );
    await expect(
      readAsStringAsync('file:///documents/download.txt', { encoding: EncodingType.Base64 })
    ).resolves.toBe('base64:file:///documents/download.txt');
  });

  it('deletes files and directories while preserving idempotent delete semantics', async () => {
    mockFileInfos.set('file:///documents/a.txt', { exists: true });
    mockFileInfos.set('file:///documents/folder', { exists: false });
    mockDirectoryInfos.set('file:///documents/folder', { exists: true });

    await deleteAsync('file:///documents/a.txt');
    await deleteAsync('file:///documents/folder');
    await deleteAsync('file:///missing', { idempotent: true });
    await expect(deleteAsync('file:///missing')).rejects.toThrow('File system path does not exist: file:///missing');

    expect(mockDeletedFiles).toEqual(['file:///documents/a.txt']);
    expect(mockDeletedDirectories).toEqual(['file:///documents/folder']);
  });
});
