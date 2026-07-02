import { beforeEach, describe, expect, it, mock, vi } from 'bun:test';

const browserClient = {
  listMemories: mock(),
  createMemory: mock(),
  updateMemory: mock(),
  deleteMemory: mock(),
};

const getBrowserClient = mock(() => browserClient);
const logger = {
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
};

mock.module('@taskforceai/contracts/browserClient', () => ({
  getBrowserClient,
}));

mock.module('../auth/csrf', () => ({
  getCsrfToken: vi.fn(async () => 'csrf-token'),
}));

mock.module('../auth/logger', () => ({
  getAuthLogger: () => logger,
}));

const { createMemory, deleteMemory, fetchMemories, updateMemory } = (await import(
  `./memories?test=${Date.now()}`
)) as typeof import('./memories');

const memory = {
  id: 7,
  content: 'Prefers concise updates',
  type: 'preference',
  created_at: '2026-06-19T00:00:00.000Z',
  updated_at: '2026-06-19T00:00:00.000Z',
};

describe('memories api helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    browserClient.listMemories.mockReset();
    browserClient.createMemory.mockReset();
    browserClient.updateMemory.mockReset();
    browserClient.deleteMemory.mockReset();
    getBrowserClient.mockClear();
  });

  it('lists memories through the browser client with CSRF support', async () => {
    browserClient.listMemories.mockResolvedValue([memory]);

    const result = await fetchMemories();

    expect(result).toEqual({ ok: true, value: [memory] });
    expect(getBrowserClient).toHaveBeenCalledWith({ getCsrfToken: expect.any(Function) });
    expect(browserClient.listMemories).toHaveBeenCalledTimes(1);
  });

  it('creates, updates, and deletes memories through the browser client', async () => {
    browserClient.createMemory.mockResolvedValue(undefined);
    browserClient.updateMemory.mockResolvedValue({ ...memory, content: 'Updated' });
    browserClient.deleteMemory.mockResolvedValue(undefined);

    await expect(createMemory({ content: 'New memory', type: 'fact' })).resolves.toEqual({
      ok: true,
      value: true,
    });
    await expect(updateMemory(7, { content: 'Updated', type: 'fact' })).resolves.toEqual({
      ok: true,
      value: { ...memory, content: 'Updated' },
    });
    await expect(deleteMemory(7)).resolves.toEqual({ ok: true, value: true });

    expect(browserClient.createMemory).toHaveBeenCalledWith({
      content: 'New memory',
      type: 'fact',
    });
    expect(browserClient.updateMemory).toHaveBeenCalledWith(7, {
      content: 'Updated',
      type: 'fact',
    });
    expect(browserClient.deleteMemory).toHaveBeenCalledWith(7);
  });

  it('maps load failures to a typed memories error and logs context', async () => {
    const error = { response: { status: 401 } };
    browserClient.listMemories.mockRejectedValue(error);

    const result = await fetchMemories();

    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'unauthorized',
        message: 'Failed to load memories',
        status: 401,
      },
    });
    expect(logger.error).toHaveBeenCalledWith('Failed to load memories', {
      error,
      memoriesError: result.ok ? undefined : result.error,
    });
  });

  it('maps create, update, and delete failures with operation-specific messages', async () => {
    browserClient.createMemory.mockRejectedValue({ status: 500 });
    browserClient.updateMemory.mockRejectedValue({ status: 404 });
    browserClient.deleteMemory.mockRejectedValue(new Error('offline'));

    await expect(createMemory({ content: 'New memory', type: 'fact' })).resolves.toEqual({
      ok: false,
      error: { kind: 'server', message: 'Failed to create memory', status: 500 },
    });
    await expect(updateMemory(9, { content: 'Missing', type: 'fact' })).resolves.toEqual({
      ok: false,
      error: { kind: 'not_found', message: 'Failed to update memory', status: 404 },
    });
    await expect(deleteMemory(9)).resolves.toEqual({
      ok: false,
      error: { kind: 'network', message: 'Failed to delete memory' },
    });

    expect(logger.error).toHaveBeenCalledWith(
      'Failed to update memory',
      expect.objectContaining({ id: 9 })
    );
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to delete memory',
      expect.objectContaining({ id: 9 })
    );
  });
});
