import { describe, expect, it } from 'bun:test';

import {
  REPORT_ISSUE_CATEGORY_VALUES,
  REPORT_ISSUE_MAX_LENGTH,
  REPORT_ISSUE_MIN_LENGTH,
} from './reportIssues';

describe('reportIssues', () => {
  describe('constants', () => {
    it('exports min and max length constants', () => {
      expect(REPORT_ISSUE_MIN_LENGTH).toBe(20);
      expect(REPORT_ISSUE_MAX_LENGTH).toBe(2000);
    });

    it('includes all expected category values', () => {
      expect(REPORT_ISSUE_CATEGORY_VALUES).toEqual([
        'model_quality',
        'ui_bug',
        'performance',
        'billing',
        'feature_request',
        'other',
      ]);
    });
  });
});
