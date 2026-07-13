import { describe, expect, it } from 'bun:test';

import { getPublicModelLabel } from './model-catalog';
import {
  canUseModelForPlan,
  deriveSelectionFromOptions,
  formatModelCostTier,
  formatUsageMultiple,
  getModelCostTier,
  hasPaidModelAccess,
  modelRequiresSubscription,
} from './model-selection';

describe('chat/model-selection', () => {
  describe('deriveSelectionFromOptions', () => {
    const options = [
      { id: 'fast', label: 'Fast' },
      { id: 'deep', label: 'Deep Research' },
      { id: 'plain' },
    ];

    it('keeps the stored selection when it is still available', () => {
      expect(
        deriveSelectionFromOptions(options, { id: 'deep', label: 'Stored Deep' }, 'fast')
      ).toEqual({
        id: 'deep',
        label: 'Deep Research',
      });
    });

    it('falls back to the stored label when the matching option has no label', () => {
      expect(deriveSelectionFromOptions(options, { id: 'plain', label: 'Stored Plain' })).toEqual({
        id: 'plain',
        label: 'Stored Plain',
      });
    });

    it('uses the backend default when the stored selection is missing', () => {
      expect(
        deriveSelectionFromOptions(options, { id: 'missing', label: 'Missing' }, 'fast')
      ).toEqual({
        id: 'fast',
        label: 'Fast',
      });
    });

    it('uses the first option when neither stored nor default selections match', () => {
      expect(
        deriveSelectionFromOptions(options, { id: 'missing', label: 'Missing' }, 'unknown')
      ).toEqual({
        id: 'fast',
        label: 'Fast',
      });
    });

    it('returns the stored selection when no options are available', () => {
      const storedSelection = { id: 'saved', label: 'Saved' };

      expect(deriveSelectionFromOptions([], storedSelection, 'fast')).toBe(storedSelection);
    });

    it('returns null when there is no stored selection and no options', () => {
      expect(deriveSelectionFromOptions([], null, 'fast')).toBeNull();
    });

    it('normalizes missing labels to null', () => {
      expect(deriveSelectionFromOptions([{ id: 'plain' }], null)).toEqual({
        id: 'plain',
        label: null,
      });
    });
  });

  describe('formatUsageMultiple', () => {
    it('formats positive integer and decimal multiples', () => {
      expect(formatUsageMultiple(1)).toBe('1X');
      expect(formatUsageMultiple(2.5)).toBe('2.5X');
      expect(formatUsageMultiple(2.345)).toBe('2.35X');
    });

    it('returns null for absent, non-finite, zero, and negative values', () => {
      expect(formatUsageMultiple()).toBeNull();
      expect(formatUsageMultiple(Number.NaN)).toBeNull();
      expect(formatUsageMultiple(Number.POSITIVE_INFINITY)).toBeNull();
      expect(formatUsageMultiple(0)).toBeNull();
      expect(formatUsageMultiple(-1)).toBeNull();
    });
  });

  describe('model cost tiers', () => {
    it('maps usage multiples onto the four customer-facing tiers', () => {
      expect(getModelCostTier(0.5)).toEqual({ symbol: '$', label: 'Low cost' });
      expect(getModelCostTier(1)).toEqual({ symbol: '$$', label: 'Medium cost' });
      expect(getModelCostTier(1.5)).toEqual({ symbol: '$$', label: 'Medium cost' });
      expect(getModelCostTier(2.5)).toEqual({ symbol: '$$$', label: 'High cost' });
      expect(getModelCostTier(4.5)).toEqual({ symbol: '$$$+', label: 'Very high cost' });
      expect(formatModelCostTier(9)).toBe('$$$+');
    });

    it('returns null when no valid cost can be derived', () => {
      expect(getModelCostTier()).toBeNull();
      expect(getModelCostTier(Number.NaN)).toBeNull();
      expect(getModelCostTier(0)).toBeNull();
      expect(formatModelCostTier(-1)).toBeNull();
    });
  });

  describe('model subscription access', () => {
    it('locks high and very-high cost models for free plans', () => {
      expect(modelRequiresSubscription(1.5)).toBe(false);
      expect(modelRequiresSubscription(2)).toBe(true);
      expect(modelRequiresSubscription(9)).toBe(true);
      expect(canUseModelForPlan('free', 1.5)).toBe(true);
      expect(canUseModelForPlan('free', 2)).toBe(false);
    });

    it('unlocks paid models for subscription plans', () => {
      expect(hasPaidModelAccess('pro')).toBe(true);
      expect(hasPaidModelAccess(' SUPER ')).toBe(true);
      expect(hasPaidModelAccess('enterprise')).toBe(true);
      expect(hasPaidModelAccess('free')).toBe(false);
      expect(hasPaidModelAccess()).toBe(false);
      expect(canUseModelForPlan('pro', 9)).toBe(true);
    });
  });

  describe('getPublicModelLabel', () => {
    it('maps Sentinel backing ids to the public model name', () => {
      expect(getPublicModelLabel('zai/glm-5.2')).toBe('Sentinel');
      expect(getPublicModelLabel('ZAI/GLM-5.2')).toBe('Sentinel');
    });

    it('keeps unknown model labels unchanged', () => {
      expect(getPublicModelLabel('custom/model')).toBe('custom/model');
      expect(getPublicModelLabel('')).toBeUndefined();
    });
  });
});
