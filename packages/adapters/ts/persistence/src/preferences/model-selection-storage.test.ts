import { describe, expect, it, mock } from 'bun:test';

import {
  parseStoredModelSelection,
  persistStoredModelSelectionValue,
  readStoredModelSelectionValue,
  serializeStoredModelSelection,
} from './model-selection-storage';

describe('chat/model-selection-storage', () => {
  it('parses legacy string and structured selections', () => {
    expect(parseStoredModelSelection(JSON.stringify('legacy-model'))).toEqual({
      id: 'legacy-model',
      label: null,
    });
    expect(parseStoredModelSelection(JSON.stringify({ id: 'gpt-5', label: 'GPT-5' }))).toEqual({
      id: 'gpt-5',
      label: 'GPT-5',
    });
    expect(parseStoredModelSelection('plain-model')).toEqual({ id: 'plain-model', label: null });
    expect(parseStoredModelSelection('')).toBeNull();
  });

  it('serializes and clears selections', () => {
    expect(serializeStoredModelSelection({ id: 'gpt-5', label: null })).toBe(
      JSON.stringify({ id: 'gpt-5', label: null })
    );
    expect(serializeStoredModelSelection(null)).toBeNull();
  });

  it('reads and persists through a storage adapter', async () => {
    const write = mock(async () => undefined);
    const remove = mock(async () => undefined);

    await expect(
      readStoredModelSelectionValue({
        read: async () => JSON.stringify({ id: 'model-a', label: 'Model A' }),
      })
    ).resolves.toEqual({ id: 'model-a', label: 'Model A' });
    await expect(readStoredModelSelectionValue({ read: async () => null })).resolves.toBeNull();

    await persistStoredModelSelectionValue(
      {
        write,
        remove,
      },
      { id: 'model-b', label: null }
    );
    expect(write).toHaveBeenCalledWith(JSON.stringify({ id: 'model-b', label: null }));

    await persistStoredModelSelectionValue({ write, remove }, null);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('reports adapter failures and returns safe fallbacks', async () => {
    const onReadError = mock(() => undefined);
    const onWriteError = mock(() => undefined);

    await expect(
      readStoredModelSelectionValue({
        read: async () => {
          throw new Error('read failed');
        },
        onReadError,
      })
    ).resolves.toBeNull();
    expect(onReadError).toHaveBeenCalledTimes(1);

    await expect(
      persistStoredModelSelectionValue(
        {
          write: async () => {
            throw new Error('write failed');
          },
          remove: async () => undefined,
          onWriteError,
        },
        { id: 'model-c', label: 'Model C' }
      )
    ).resolves.toBeUndefined();
    expect(onWriteError).toHaveBeenCalledWith(expect.any(Error), {
      id: 'model-c',
      label: 'Model C',
    });
  });
});
