import { type ModelSelectorResponse } from '@taskforceai/contracts/contracts';
import { fetchModelOptions } from '@taskforceai/api-client/utils/models';
import { logger } from '../logger';
import { getServerBaseUrl } from '@taskforceai/config/server-base-url';
import { PUBLIC_MODEL_SELECTOR_CATALOG } from '@taskforceai/client-core/chat/model-catalog';

const catalogOptionsById = new Map(
  PUBLIC_MODEL_SELECTOR_CATALOG.options.map((option) => [option.id, option])
);

const withCatalogCapabilities = (models: ModelSelectorResponse): ModelSelectorResponse => ({
  ...models,
  options: models.options.map((option) => {
    const catalogOption = catalogOptionsById.get(option.id);
    return {
      ...option,
      reasoningEffortLevels: option.reasoningEffortLevels ?? catalogOption?.reasoningEffortLevels,
      defaultReasoningEffort:
        option.defaultReasoningEffort ?? catalogOption?.defaultReasoningEffort,
    };
  }),
});

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
    return withCatalogCapabilities(result.value);
  }

  logger.error('Failed to fetch models from API', { error: result.error });
  throw result.error instanceof Error ? result.error : new Error('Failed to fetch models from API');
};
