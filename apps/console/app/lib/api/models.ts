import { type ModelSelectorResponse } from '@taskforceai/contracts';
import { fetchModelOptions } from '@taskforceai/contracts/utils/models';
import { logger } from '../logger';
import { getServerBaseUrl } from './server-base-url';

/**
 * Fetches the list of available AI models from the core API.
 * The models are defined in config/config.yaml on the backend.
 */
export const fetchModels = async ({
  baseUrl = getServerBaseUrl(),
}: {
  baseUrl?: string;
} = {}): Promise<ModelSelectorResponse> => {
  const result = await fetchModelOptions({
    baseUrl,
    cache: 'no-store',
  });

  if (result.ok) {
    return result.value;
  }

  logger.error('Failed to fetch models from API', { error: result.error });
  // Fallback to a minimal default state if the API is unavailable
  return {
    enabled: true,
    defaultModelId: 'moonshotai/kimi-k2.6',
    options: [
      {
        id: 'moonshotai/kimi-k2.6',
        label: 'Sentinel',
        badge: 'Default',
        description: 'Our flagship high-reasoning model, optimized for complex task planning.',
        usageMultiple: 1.0,
      },
      {
        id: 'xai/grok-4.3',
        label: 'Grok 4.3',
        badge: 'Pro',
        description: "xAI's latest heavy reasoning tier with extended planning depth.",
        usageMultiple: 2,
      },
      {
        id: 'xai/grok-imagine-video',
        label: 'Grok Imagine Video',
        badge: 'Video',
        description:
          'AI Gateway video generation for text-to-video, image-to-video, and video editing.',
        usageMultiple: 4,
      },
    ],
  };
};
