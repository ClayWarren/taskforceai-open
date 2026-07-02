import { describe, expect, it } from 'bun:test';

import {
  REPORT_ISSUE_CATEGORIES,
  REPORT_ISSUE_CATEGORY_LABEL,
  REPORT_ISSUE_MAX_LENGTH,
  REPORT_ISSUE_MIN_LENGTH,
} from './reportIssues';

describe('reportIssues', () => {
  describe('constants', () => {
    it('exports min and max length constants', () => {
      expect(REPORT_ISSUE_MIN_LENGTH).toBe(20);
      expect(REPORT_ISSUE_MAX_LENGTH).toBe(2000);
    });

    it('exports categories array with required fields', () => {
      expect(REPORT_ISSUE_CATEGORIES).toHaveLength(6);

      for (const category of REPORT_ISSUE_CATEGORIES) {
        expect(category).toHaveProperty('value');
        expect(category).toHaveProperty('label');
        expect(category).toHaveProperty('description');
        expect(typeof category.value).toBe('string');
        expect(typeof category.label).toBe('string');
        expect(typeof category.description).toBe('string');
      }
    });

    it('includes all expected category values', () => {
      const values = REPORT_ISSUE_CATEGORIES.map((c) => c.value);

      expect(values).toContain('model_quality');
      expect(values).toContain('ui_bug');
      expect(values).toContain('performance');
      expect(values).toContain('billing');
      expect(values).toContain('feature_request');
      expect(values).toContain('other');
    });
  });

  describe('REPORT_ISSUE_CATEGORY_LABEL', () => {
    it('maps all category values to labels', () => {
      expect(Object.keys(REPORT_ISSUE_CATEGORY_LABEL)).toHaveLength(6);

      expect(REPORT_ISSUE_CATEGORY_LABEL.model_quality).toBe('Model or answer quality');
      expect(REPORT_ISSUE_CATEGORY_LABEL.ui_bug).toBe('UI or interaction bug');
      expect(REPORT_ISSUE_CATEGORY_LABEL.performance).toBe('Performance or reliability');
      expect(REPORT_ISSUE_CATEGORY_LABEL.billing).toBe('Billing or account');
      expect(REPORT_ISSUE_CATEGORY_LABEL.feature_request).toBe('Feature request');
      expect(REPORT_ISSUE_CATEGORY_LABEL.other).toBe('Something else');
    });
  });
});
