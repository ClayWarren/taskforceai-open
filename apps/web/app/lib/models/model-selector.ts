import type { ModelSelectorResponse } from '@taskforceai/contracts/contracts';

import { type ModelOptionsError, fetchModelSelectorSnapshot } from '../api/models';
import { PUBLIC_MODEL_SELECTOR_CATALOG } from '@taskforceai/client-core';
import { ok, type Result } from '@taskforceai/client-core/result';
import { detectRuntime } from '@taskforceai/browser-runtime/runtime';
import { listDesktopAppServerModels } from '../platform/desktop-api';

const MODEL_OPTIONS_CACHE_TTL_MS = 5 * 60 * 1000;

let cachedModelOptions: {
  value: ModelSelectorResponse;
  expiresAt: number;
} | null = null;
let modelOptionsRequest: Promise<Result<ModelSelectorResponse, ModelOptionsError>> | null = null;

interface LoadModelOptionsOptions {
  fetchModelOptionsImpl?: typeof fetchModelSelectorSnapshot;
}

/**
 * Load model options for the model selector.
 */
// prettier-ignore
export const loadModelOptions = async ({
  fetchModelOptionsImpl = fetchModelSelectorSnapshot,
}: LoadModelOptionsOptions = {}): Promise<
  Result<ModelSelectorResponse, ModelOptionsError>
> => {
  if (detectRuntime() === 'desktop') {
    try {
      const result = await listDesktopAppServerModels();
      return {
        ok: true,
        value: {
          enabled: result.enabled,
          options: result.options.map((option) => ({
            id: option.id,
            label: option.label,
            badge: option.badge,
            ...(option.description ? { description: option.description } : {}),
            ...(option.usageMultiple ? { usageMultiple: option.usageMultiple } : {}),
            ...(option.reasoningEffortLevels?.length
              ? { reasoningEffortLevels: option.reasoningEffortLevels }
              : {}),
            ...(option.defaultReasoningEffort
              ? { defaultReasoningEffort: option.defaultReasoningEffort }
              : {}),
          })),
          defaultModelId: result.selectedModelId || result.defaultModelId,
        },
      };
    } catch {
      return {
        ok: false,
        error: {
          kind: 'server',
          message: 'Failed to load desktop model options',
          status: 500,
        },
      };
    }
  }

  const now = Date.now();
  if (cachedModelOptions && cachedModelOptions.expiresAt > now) {
    return { ok: true, value: cachedModelOptions.value };
  }

  if (modelOptionsRequest) {
    return modelOptionsRequest;
  }

  modelOptionsRequest = fetchModelOptionsImpl({ logger: null }).then((result) => {
    if (result.ok) {
      cachedModelOptions = {
        value: result.value,
        expiresAt: Date.now() + MODEL_OPTIONS_CACHE_TTL_MS,
      };
      return result;
    }
    cachedModelOptions = {
      value: PUBLIC_MODEL_SELECTOR_CATALOG,
      expiresAt: Date.now() + MODEL_OPTIONS_CACHE_TTL_MS,
    };
    return ok(PUBLIC_MODEL_SELECTOR_CATALOG);
  }).finally(() => {
    modelOptionsRequest = null;
  });

  return modelOptionsRequest;
};
