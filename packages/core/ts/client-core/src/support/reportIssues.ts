export const REPORT_ISSUE_MIN_LENGTH = 20;
export const REPORT_ISSUE_MAX_LENGTH = 2000;

export const REPORT_ISSUE_CATEGORY_VALUES = [
  'model_quality',
  'ui_bug',
  'performance',
  'billing',
  'feature_request',
  'other',
] as const;

export type ReportIssueCategory = (typeof REPORT_ISSUE_CATEGORY_VALUES)[number];
