import { describe, it, expect, vi, beforeEach } from 'bun:test';
import { fetchModels } from './models';

vi.mock('./server-base-url', () => ({
  getServerBaseUrl: () => 'http://localhost:3000',
}));

vi.mock('@taskforceai/contracts/utils/models', () => ({
  fetchModelOptions: vi.fn(),
}));

vi.mock('../logger', () => ({
  logger: {
    error: vi.fn(),
  },
}));

import { fetchModelOptions } from '@taskforceai/contracts/utils/models';

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

    it('returns fallback models on failure', async () => {
      (fetchModelOptions as any).mockResolvedValue({
        ok: false,
        error: new Error('API unavailable'),
      });

      const result = await fetchModels();
      expect(result.enabled).toBe(true);
      expect(result.defaultModelId).toBe('moonshotai/kimi-k2.6');
      expect(result.options).toHaveLength(3);
      expect(result.options[0]!.label).toBe('Sentinel');
      expect(result.options[2]!.id).toBe('xai/grok-imagine-video');
    });
  });
});
