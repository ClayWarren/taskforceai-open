import { describe, it, expect, vi, beforeEach } from 'bun:test';
import { fetchModels } from './models';

vi.mock('@taskforceai/config/server-base-url', () => ({
  getServerBaseUrl: () => 'http://localhost:3000',
}));

vi.mock('@taskforceai/api-client/utils/models', () => ({
  fetchModelOptions: vi.fn(),
}));

vi.mock('../logger', () => ({
  logger: {
    error: vi.fn(),
  },
}));

import { fetchModelOptions } from '@taskforceai/api-client/utils/models';

describe('models api', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('fetchModels', () => {
    it('returns models on success', async () => {
      const mockModels = {
        enabled: true,
        defaultModelId: 'test-model',
        options: [
          {
            id: 'test-model',
            label: 'Test Model',
            badge: 'Default',
            description: 'A test model',
            usageMultiple: 1.0,
          },
        ],
      };
      (fetchModelOptions as any).mockResolvedValue({ ok: true, value: mockModels });

      const result = await fetchModels();
      expect(result.enabled).toBe(true);
      expect(result.defaultModelId).toBe('test-model');
      expect(result.options).toHaveLength(1);
    });

    it('fills capability metadata from the shared model catalog', async () => {
      (fetchModelOptions as any).mockResolvedValue({
        ok: true,
        value: {
          enabled: true,
          defaultModelId: 'xai/grok-4.5',
          options: [
            {
              id: 'xai/grok-4.5',
              label: 'Grok 4.5',
              badge: 'Pro',
              usageMultiple: 2,
            },
          ],
        },
      });

      const result = await fetchModels();

      expect(result.options[0]).toMatchObject({
        reasoningEffortLevels: ['low', 'medium', 'high'],
        defaultReasoningEffort: 'high',
      });
    });

    it('throws when model options fail to load', async () => {
      const apiError = new Error('API unavailable');
      (fetchModelOptions as any).mockResolvedValue({
        ok: false,
        error: apiError,
      });

      await expect(fetchModels()).rejects.toThrow('API unavailable');
    });
  });
});
