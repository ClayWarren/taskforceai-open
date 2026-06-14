import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

const mockFetchModelOptions = vi.fn();

const { PUBLIC_MODEL_SELECTOR_CATALOG } = await import('@taskforceai/shared');
const { loadModelOptions } = await import('./model-selector');

let now = Date.now();
const originalDateNow = Date.now;

describe('model-selector', () => {
  beforeEach(() => {
    now += 10 * 60 * 1000;
    Date.now = () => now;
    mockFetchModelOptions.mockReset();
  });

  afterEach(() => {
    Date.now = originalDateNow;
  });

  describe('loadModelOptions', () => {
    it('returns model options on success', async () => {
      const modelOptions = {
        enabled: true,
        options: [{ id: 'gpt-4', label: 'GPT-4', badge: 'default' }],
        defaultModelId: 'gpt-4',
      };
      mockFetchModelOptions.mockResolvedValue({
        ok: true,
        value: modelOptions,
      });

      const result = await loadModelOptions({ fetchModelOptionsImpl: mockFetchModelOptions });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(modelOptions);
      }
    });

    it('falls back to the public model catalog on failure', async () => {
      mockFetchModelOptions.mockResolvedValue({
        ok: false,
        error: { kind: 'network', message: 'Network error' },
      });

      const result = await loadModelOptions({ fetchModelOptionsImpl: mockFetchModelOptions });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(PUBLIC_MODEL_SELECTOR_CATALOG);
      }
    });

    it('reuses a fresh successful response', async () => {
      const modelOptions = {
        enabled: true,
        options: [{ id: 'gpt-4', label: 'GPT-4', badge: 'default' }],
        defaultModelId: 'gpt-4',
      };
      mockFetchModelOptions.mockResolvedValue({
        ok: true,
        value: modelOptions,
      });

      const first = await loadModelOptions({ fetchModelOptionsImpl: mockFetchModelOptions });
      const second = await loadModelOptions({ fetchModelOptionsImpl: mockFetchModelOptions });

      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      expect(mockFetchModelOptions).toHaveBeenCalledTimes(1);
    });

    it('shares an in-flight model options request', async () => {
      const modelOptions = {
        enabled: true,
        options: [{ id: 'gpt-4', label: 'GPT-4', badge: 'default' }],
        defaultModelId: 'gpt-4',
      };
      mockFetchModelOptions.mockResolvedValue({
        ok: true,
        value: modelOptions,
      });

      const [first, second] = await Promise.all([
        loadModelOptions({ fetchModelOptionsImpl: mockFetchModelOptions }),
        loadModelOptions({ fetchModelOptionsImpl: mockFetchModelOptions }),
      ]);

      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      expect(mockFetchModelOptions).toHaveBeenCalledTimes(1);
    });
  });
});
