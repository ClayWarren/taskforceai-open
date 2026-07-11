import { Directory, EncodingType, File, Paths } from 'expo-file-system';

export { EncodingType };

export const documentDirectory = Paths.document.uri;
export const cacheDirectory = Paths.cache.uri;

export type FileInfo = {
  exists: boolean;
  uri: string;
  size?: number;
  modificationTime?: number;
  md5?: string;
  isDirectory?: boolean;
};

export async function getInfoAsync(
  uri: string,
  options?: { md5?: boolean }
): Promise<FileInfo> {
  try {
    const file = new File(uri);
    const info = file.info(options);
    if (info.exists) {
      return {
        exists: true,
        uri,
        size: info.size,
        modificationTime:
          typeof info.modificationTime === 'number'
            ? Math.floor(info.modificationTime / 1000)
            : undefined,
        md5: info.md5,
        isDirectory: false,
      };
    }
  } catch {
    // Try directory metadata below.
  }

  try {
    const directory = new Directory(uri);
    const info = directory.info();
    if (info.exists) {
      return {
        exists: true,
        uri,
        size: info.size,
        modificationTime:
          typeof info.modificationTime === 'number'
            ? Math.floor(info.modificationTime / 1000)
            : undefined,
        isDirectory: true,
      };
    }
  } catch {
    // Missing or inaccessible paths are reported as non-existent, matching the old helper.
  }

  return { exists: false, uri };
}

export async function readDirectoryAsync(uri: string): Promise<string[]> {
  return new Directory(uri).list().map((entry) => entry.name);
}

export async function writeAsStringAsync(
  uri: string,
  contents: string,
  options?: { encoding?: EncodingType | 'utf8' | 'base64' }
): Promise<void> {
  const file = new File(uri);
  if (!file.exists) {
    file.create({ intermediates: true, overwrite: true });
  }
  file.write(contents, options);
}

export async function writeBytesAsync(uri: string, contents: Uint8Array): Promise<void> {
  const file = new File(uri);
  if (!file.exists) {
    file.create({ intermediates: true, overwrite: true });
  }
  file.write(contents);
}

export async function downloadFileAsync(
  url: string,
  uri: string,
  options: {
    headers?: Record<string, string>;
    onProgress?: (progress: { bytesWritten: number; totalBytes: number }) => void;
    signal?: AbortSignal;
  } = {}
): Promise<void> {
  await File.downloadFileAsync(url, new File(uri), {
    headers: options.headers,
    idempotent: true,
    onProgress: options.onProgress,
    signal: options.signal,
  });
}

export async function readAsStringAsync(
  uri: string,
  options?: { encoding?: EncodingType | 'utf8' | 'base64' }
): Promise<string> {
  const file = new File(uri);
  const encoding = options?.encoding as string | undefined;
  if (encoding === EncodingType.Base64 || encoding === 'base64') {
    return file.base64();
  }
  return file.text();
}

export async function deleteAsync(
  uri: string,
  options?: { idempotent?: boolean }
): Promise<void> {
  const info = await getInfoAsync(uri);
  if (!info.exists) {
    if (options?.idempotent) {
      return;
    }
    throw new Error(`File system path does not exist: ${uri}`);
  }

  if (info.isDirectory) {
    new Directory(uri).delete();
    return;
  }

  new File(uri).delete();
}
