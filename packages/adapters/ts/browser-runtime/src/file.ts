export { formatFileSize } from '@taskforceai/presenters/utils/file';

interface MinimalFileReader {
  readAsText(blob: Blob): void;
  readonly result: string | ArrayBuffer | null;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}

type FileReaderConstructor = new () => MinimalFileReader;

export const readFileContent = async (
  file: File | Blob,
  FileReaderImpl?: FileReaderConstructor
): Promise<string> => {
  if ('text' in file && typeof file.text === 'function') {
    return file.text();
  }

  const Implementation =
    FileReaderImpl ??
    (typeof window !== 'undefined'
      ? (window.FileReader as unknown as FileReaderConstructor)
      : undefined) ??
    ('FileReader' in globalThis
      ? (globalThis as unknown as { FileReader: FileReaderConstructor }).FileReader
      : undefined);

  if (!Implementation) {
    throw new Error('FileReader not available in this environment');
  }

  return await new Promise<string>((resolve, reject) => {
    const reader = new Implementation();

    const handleLoad = (e: Event) => {
      const target = e.target as (EventTarget & { result?: string | ArrayBuffer | null }) | null;
      const result = target?.result ?? reader.result;
      if (typeof result === 'string') {
        resolve(result);
      } else if (result instanceof ArrayBuffer) {
        resolve(new TextDecoder().decode(result));
      } else {
        reject(new Error('FileReader result is not a string'));
      }
      cleanup();
    };

    const handleError = (e: Event) => {
      cleanup();
      reject(e);
    };

    let listenersAdded = false;
    const cleanup = () => {
      if (listenersAdded) {
        reader.removeEventListener('load', handleLoad as EventListener);
        reader.removeEventListener('error', handleError as EventListener);
      }
    };

    try {
      reader.addEventListener('load', handleLoad as EventListener);
      reader.addEventListener('error', handleError as EventListener);
      listenersAdded = true;
      reader.readAsText(file);
    } catch (e) {
      cleanup();
      reject(e);
    }
  });
};
