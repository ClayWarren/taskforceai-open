import { describe, expect, it } from 'bun:test';

import { getPublicModelLabel, PUBLIC_MODEL_SELECTOR_CATALOG } from './model-catalog';

describe('chat/model-catalog', () => {
  const expectedAddedModelLabels = new Map([
    ['meta/muse-spark-1.1', 'Muse Spark 1.1'],
    ['openai/gpt-5.6-sol', 'GPT 5.6 Sol'],
    ['openai/gpt-5.6-terra', 'GPT 5.6 Terra'],
    ['openai/gpt-5.6-luna', 'GPT 5.6 Luna'],
    ['anthropic/claude-sonnet-5', 'Claude Sonnet 5'],
    ['anthropic/claude-opus-4.8', 'Claude Opus 4.8'],
    ['anthropic/claude-haiku-4.5', 'Claude Haiku 4.5'],
    ['google/gemini-3.5-flash', 'Gemini 3.5 Flash'],
    ['google/gemini-3.1-flash-lite', 'Gemini 3.1 Flash Lite'],
  ]);
  const expectedReasoningEffortByModel = new Map([
    ['xai/grok-4.5', { levels: ['low', 'medium', 'high'], defaultEffort: 'high' }],
    ['google/gemini-3.1-pro-preview', { levels: ['low', 'medium', 'high'], defaultEffort: 'high' }],
    [
      'google/gemini-3.5-flash',
      { levels: ['minimal', 'low', 'medium', 'high'], defaultEffort: 'medium' },
    ],
    [
      'google/gemini-3.1-flash-lite',
      { levels: ['minimal', 'low', 'medium', 'high'], defaultEffort: 'minimal' },
    ],
    [
      'openai/gpt-5.6-sol',
      { levels: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'medium' },
    ],
    [
      'openai/gpt-5.6-terra',
      { levels: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'medium' },
    ],
    [
      'openai/gpt-5.6-luna',
      { levels: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'medium' },
    ],
    [
      'anthropic/claude-fable-5',
      { levels: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'high' },
    ],
    [
      'anthropic/claude-sonnet-5',
      { levels: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'high' },
    ],
    [
      'anthropic/claude-opus-4.8',
      { levels: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'high' },
    ],
  ]);

  it('defines an enabled catalog with a default option that appears once', () => {
    const optionIds = PUBLIC_MODEL_SELECTOR_CATALOG.options.map((option) => option.id);

    expect(PUBLIC_MODEL_SELECTOR_CATALOG.enabled).toBe(true);
    expect(optionIds).toContain(PUBLIC_MODEL_SELECTOR_CATALOG.defaultModelId);
    expect(new Set(optionIds).size).toBe(optionIds.length);
    for (const modelId of expectedAddedModelLabels.keys()) {
      expect(optionIds).toContain(modelId);
    }
    expect(optionIds).not.toContain('openai/gpt-5.5');
  });

  it('keeps every public model option displayable', () => {
    for (const option of PUBLIC_MODEL_SELECTOR_CATALOG.options) {
      expect(option.id.trim()).toBe(option.id);
      expect(option.id).not.toBe('');
      expect(option.label).not.toBe('');
      expect(option.badge).not.toBe('');
      expect(option.usageMultiple ?? 1).toBeGreaterThan(0);
      expect(getPublicModelLabel(option.id.toUpperCase())).toBe(option.label);
    }
  });

  it('preserves reasoning effort capabilities in the bootstrap fallback catalog', () => {
    const optionsById = new Map(
      PUBLIC_MODEL_SELECTOR_CATALOG.options.map((option) => [option.id, option])
    );

    for (const [modelId, expected] of expectedReasoningEffortByModel) {
      const option = optionsById.get(modelId);
      expect(option?.reasoningEffortLevels).toEqual(expected.levels);
      expect(option?.defaultReasoningEffort).toBe(expected.defaultEffort);
    }

    expect(
      PUBLIC_MODEL_SELECTOR_CATALOG.options.filter(
        (option) => option.reasoningEffortLevels !== undefined
      )
    ).toHaveLength(expectedReasoningEffortByModel.size);
  });

  it('normalizes known ids and preserves unknown labels', () => {
    expect(getPublicModelLabel(' zai/glm-5.2 ')).toBe('Sentinel');
    for (const [modelId, label] of expectedAddedModelLabels) {
      expect(getPublicModelLabel(modelId.toUpperCase())).toBe(label);
    }
    expect(getPublicModelLabel('custom/model')).toBe('custom/model');
    expect(getPublicModelLabel(null)).toBeUndefined();
    expect(getPublicModelLabel('   ')).toBeUndefined();
  });
});
