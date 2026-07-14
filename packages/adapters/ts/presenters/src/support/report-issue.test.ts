import { describe, expect, it } from 'bun:test';

import { REPORT_ISSUE_CATEGORIES, REPORT_ISSUE_CATEGORY_LABEL } from './report-issue';

describe('report issue presenter', () => {
  it('provides labels and descriptions for every category', () => {
    expect(REPORT_ISSUE_CATEGORIES).toHaveLength(6);
    for (const category of REPORT_ISSUE_CATEGORIES) {
      expect(category.label.length).toBeGreaterThan(0);
      expect(category.description.length).toBeGreaterThan(0);
    }
  });

  it('maps category values to labels', () => {
    expect(REPORT_ISSUE_CATEGORY_LABEL.model_quality).toBe('Model or answer quality');
    expect(REPORT_ISSUE_CATEGORY_LABEL.other).toBe('Something else');
  });
});
