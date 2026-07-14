import { type Result, err, ok } from '@taskforceai/client-core/result';

const themePreferenceSchema = ['light', 'dark', 'system'] as const;
export type ThemePreference = (typeof themePreferenceSchema)[number];

export type ThemeStorageError = {
  kind: 'unavailable' | 'invalid' | 'failed';
  message: string;
};

export interface ThemeStorageAdapter {
  read: () => string | null | Promise<string | null>;
  write: (value: string) => void | Promise<void>;
  remove: () => void | Promise<void>;
}

export interface ThemeStorageOptions {
  allowedModes?: readonly string[];
  invalidKind?: ThemeStorageError['kind'];
  unavailableMessage?: string;
  invalidMessage?: string;
  readFailedMessage?: string;
  writeFailedMessage?: string;
  removeFailedMessage?: string;
  onReadError?: (error: unknown) => void;
  onWriteError?: (error: unknown, mode: string) => void;
  onRemoveError?: (error: unknown) => void;
}

const DEFAULT_ALLOWED_MODES = themePreferenceSchema;

const includesMode = (allowedModes: readonly string[], mode: string): boolean =>
  allowedModes.includes(mode);

const parseStoredThemeMode = <TMode extends string>(
  raw: string | null,
  allowedModes?: readonly TMode[]
): TMode | null => {
  if (!raw) {
    return null;
  }
  const modes = allowedModes ?? DEFAULT_ALLOWED_MODES;
  return includesMode(modes, raw) ? (raw as TMode) : null;
};

export const readStoredThemeModeValue = async <TMode extends string>(
  adapter: Pick<ThemeStorageAdapter, 'read'>,
  options: ThemeStorageOptions & { allowedModes?: readonly TMode[] } = {}
): Promise<TMode | null> => {
  try {
    const raw = await adapter.read();
    return parseStoredThemeMode(raw, options.allowedModes);
  } catch (error) {
    options.onReadError?.(error);
    return null;
  }
};

export const storeThemeModeValue = async (
  adapter: Pick<ThemeStorageAdapter, 'write'>,
  mode: string,
  options: Pick<ThemeStorageOptions, 'onWriteError'> = {}
): Promise<void> => {
  try {
    await adapter.write(mode);
  } catch (error) {
    options.onWriteError?.(error, mode);
  }
};

export const readStoredThemePreferenceResult = (
  readRaw: () => Result<string, unknown>,
  options: ThemeStorageOptions = {}
): Result<ThemePreference, ThemeStorageError> => {
  const raw = readRaw();
  if (!raw.ok) {
    const error = raw.error;
    if (
      typeof error === 'object' &&
      error !== null &&
      'kind' in error &&
      (error as { kind?: unknown }).kind === 'invalid'
    ) {
      return err({
        kind: options.invalidKind ?? 'invalid',
        message: options.invalidMessage ?? 'No stored theme preference.',
      });
    }
    return err({
      kind: 'failed',
      message: options.readFailedMessage ?? 'Failed to read theme preference.',
    });
  }

  const theme = parseStoredThemeMode(raw.value, themePreferenceSchema);
  if (!theme) {
    return err({
      kind: options.invalidKind ?? 'invalid',
      message: options.invalidMessage ?? 'No stored theme preference.',
    });
  }
  return ok(theme);
};
