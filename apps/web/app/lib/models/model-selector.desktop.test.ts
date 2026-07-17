import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { AppServerModelListResult } from '@taskforceai/contracts/app-server';

const detectRuntimeMock = mock(() => 'desktop');
const desktopModelList = (
  overrides: Partial<AppServerModelListResult> = {}
): AppServerModelListResult => ({
  enabled: true,
  options: [],
  defaultModelId: 'gpt-5',
  selectedModelId: null,
  remoteCatalog: false,
  ...overrides,
});
const listDesktopAppServerModelsMock = mock(async () => desktopModelList());

mock.module('@taskforceai/browser-runtime/runtime', () => ({
  detectRuntime: detectRuntimeMock,
  initializeDesktopRuntime: mock((onInitialize?: () => void) => {
    if (detectRuntimeMock() === 'desktop') {
      onInitialize?.();
    }
  }),
  isDesktopRuntime: mock(() => detectRuntimeMock() === 'desktop'),
}));

mock.module('../platform/desktop-api', () => ({
  listDesktopAppServerModels: listDesktopAppServerModelsMock,
}));

const { loadModelOptions } = await import('./model-selector');

describe('model-selector desktop runtime', () => {
  beforeEach(() => {
    detectRuntimeMock.mockReset();
    detectRuntimeMock.mockReturnValue('desktop');
    listDesktopAppServerModelsMock.mockReset();
    listDesktopAppServerModelsMock.mockResolvedValue(desktopModelList());
  });

  it('maps desktop app-server model options to selector options', async () => {
    listDesktopAppServerModelsMock.mockResolvedValue(
      desktopModelList({
        options: [
          {
            id: 'ollama/llama3.2',
            label: 'Llama 3.2',
            badge: 'local',
            description: 'Local model',
            usageMultiple: 0.2,
          },
          {
            id: 'openai/gpt-5-mini',
            label: 'GPT-5 Mini',
            badge: 'fast',
            description: null,
            usageMultiple: null,
            reasoningEffortLevels: ['low', 'medium', 'high'],
            defaultReasoningEffort: 'medium',
          },
        ],
        defaultModelId: 'openai/gpt-5-mini',
        selectedModelId: 'ollama/llama3.2',
      })
    );

    const result = await loadModelOptions();

    expect(result).toEqual({
      ok: true,
      value: {
        enabled: true,
        options: [
          {
            id: 'ollama/llama3.2',
            label: 'Llama 3.2',
            badge: 'local',
            description: 'Local model',
            usageMultiple: 0.2,
          },
          {
            id: 'openai/gpt-5-mini',
            label: 'GPT-5 Mini',
            badge: 'fast',
            reasoningEffortLevels: ['low', 'medium', 'high'],
            defaultReasoningEffort: 'medium',
          },
        ],
        defaultModelId: 'ollama/llama3.2',
      },
    });
    expect(listDesktopAppServerModelsMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to the desktop default model when no selected model is set', async () => {
    listDesktopAppServerModelsMock.mockResolvedValue(
      desktopModelList({
        enabled: false,
        options: [],
        defaultModelId: 'openai/gpt-5',
        selectedModelId: '',
        remoteCatalog: true,
      })
    );

    const result = await loadModelOptions();

    expect(result).toEqual({
      ok: true,
      value: {
        enabled: false,
        options: [],
        defaultModelId: 'openai/gpt-5',
      },
    });
  });

  it('returns a server error when desktop model loading fails', async () => {
    listDesktopAppServerModelsMock.mockRejectedValue(new Error('tauri failed'));

    const result = await loadModelOptions();

    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'server',
        message: 'Failed to load desktop model options',
        status: 500,
      },
    });
  });
});
