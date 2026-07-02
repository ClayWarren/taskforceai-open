import { describe, expect, it } from 'bun:test';

import { getPublicModelLabel, PUBLIC_MODEL_SELECTOR_CATALOG } from './model-catalog';

describe('chat/model-catalog', () => {
  it('defines an enabled catalog with a default option that appears once', () => {
    const optionIds = PUBLIC_MODEL_SELECTOR_CATALOG.options.map((option) => option.id);

    expect(PUBLIC_MODEL_SELECTOR_CATALOG.enabled).toBe(true);
    expect(optionIds).toContain(PUBLIC_MODEL_SELECTOR_CATALOG.defaultModelId);
    expect(new Set(optionIds).size).toBe(optionIds.length);
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

  it('normalizes known ids and preserves unknown labels', () => {
    expect(getPublicModelLabel(' zai/glm-5.2 ')).toBe('Sentinel');
    expect(getPublicModelLabel('custom/model')).toBe('custom/model');
    expect(getPublicModelLabel(null)).toBeUndefined();
    expect(getPublicModelLabel('   ')).toBeUndefined();
  });
});
