import { type ModelSelectorResponse, modelSelectorResponseSchema } from '../contracts';
import { type Result, err, ok } from './result';

export interface FetchModelsOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  cache?: RequestCache;
}

export const fetchModelOptions = async (
  options: FetchModelsOptions
): Promise<Result<ModelSelectorResponse>> => {
  const { baseUrl, fetch = globalThis.fetch, cache = 'default' } = options;
  try {
    const response = await fetch(`${baseUrl}/api/v1/models`, { cache });

    if (!response.ok) {
      const error = new Error(`Failed to fetch models: ${response.status}`);
      (error as any).status = response.status;
      return err(error);
    }

    const data = await response.json();
    const parsed = modelSelectorResponseSchema.safeParse(data);

    if (!parsed.success) {
      return err(new Error('Invalid model options response schema'));
    }

    return ok(parsed.data);
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
};
