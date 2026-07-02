export const REPORT_ISSUE_MIN_LENGTH = 20;
export const REPORT_ISSUE_MAX_LENGTH = 2000;

export const REPORT_ISSUE_CATEGORIES = [
  {
    value: 'model_quality',
    label: 'Model or answer quality',
    description: 'Incorrect, incomplete, or unsafe response.',
  },
  {
    value: 'ui_bug',
    label: 'UI or interaction bug',
    description: 'Buttons, chat, or interface problems.',
  },
  {
    value: 'performance',
    label: 'Performance or reliability',
    description: 'Slow responses, crashes, or offline issues.',
  },
  {
    value: 'billing',
    label: 'Billing or account',
    description: 'Charges, plan limits, account access.',
  },
  {
    value: 'feature_request',
    label: 'Feature request',
    description: 'Ideas that would improve the experience.',
  },
  {
    value: 'other',
    label: 'Something else',
    description: 'Anything not covered above.',
  },
] as const;

export type ReportIssueCategory = (typeof REPORT_ISSUE_CATEGORIES)[number]['value'];

export const REPORT_ISSUE_CATEGORY_LABEL: Record<ReportIssueCategory, string> =
  REPORT_ISSUE_CATEGORIES.reduce(
    (acc, category) => {
      acc[category.value] = category.label;
      return acc;
    },
    {} as Record<ReportIssueCategory, string>
  );
