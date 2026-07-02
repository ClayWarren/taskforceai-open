import { z } from 'zod';
import { parseJsonSchema } from '../json/parse';
import type { StoredModelSelection } from './model-selection';

export type { StoredModelSelection };

type MaybePromise<T> = T | Promise<T>;

export interface ModelSelectionStorageAdapter {
  read: () => MaybePromise<string | null>;
  write: (value: string) => MaybePromise<void>;
  remove: () => MaybePromise<void>;
  onReadError?: (error: unknown) => void;
  onWriteError?: (error: unknown, selection: StoredModelSelection | null) => void;
}

export const storedModelSchema = z.union([
  z.string(),
  z.object({
    id: z.string(),
    label: z.string().nullable().optional(),
  }),
]);

export const parseStoredModelSelection = (raw: string): StoredModelSelection | null => {
  const parsed = parseJsonSchema(raw, storedModelSchema);
  if (!parsed.ok) {
    return raw.length > 0 ? { id: raw, label: null } : null;
  }

  const validated = parsed.value;
  if (typeof validated === 'string') {
    return { id: validated, label: null };
  }

  return {
    id: validated.id,
    label: validated.label ?? null,
  };
};

export const serializeStoredModelSelection = (
  selection: StoredModelSelection | null
): string | null => {
  if (!selection) return null;
  return JSON.stringify({ id: selection.id, label: selection.label });
};

export const readStoredModelSelectionValue = async (
  adapter: Pick<ModelSelectionStorageAdapter, 'read' | 'onReadError'>
): Promise<StoredModelSelection | null> => {
  try {
    const raw = await adapter.read();
    return raw ? parseStoredModelSelection(raw) : null;
  } catch (error) {
    adapter.onReadError?.(error);
    return null;
  }
};

export const persistStoredModelSelectionValue = async (
  adapter: Pick<ModelSelectionStorageAdapter, 'write' | 'remove' | 'onWriteError'>,
  selection: StoredModelSelection | null
): Promise<void> => {
  try {
    const serialized = serializeStoredModelSelection(selection);
    if (!serialized) {
      await adapter.remove();
      return;
    }
    await adapter.write(serialized);
  } catch (error) {
    adapter.onWriteError?.(error, selection);
  }
};
