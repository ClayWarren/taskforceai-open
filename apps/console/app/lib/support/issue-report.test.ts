import { beforeEach, describe, expect, it, vi } from 'bun:test';

const mockSubmitIssueReport = vi.fn();

vi.mock('@taskforceai/contracts', () => ({
  submitIssueReport: mockSubmitIssueReport,
}));

vi.mock('@taskforceai/shared/config/app-env', () => ({
  getRuntimeEnv: () => undefined,
}));

import { submitIssueReportWithVersion } from './issue-report';

describe('console issue-report', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSubmitIssueReport.mockResolvedValue({ ok: true, value: undefined });
  });

  it('forwards reports with the console app version fallback', async () => {
    const result = await submitIssueReportWithVersion({
      category: 'ui_bug',
      description: 'Console report',
    });

    expect(result).toEqual({ ok: true, value: undefined });
    expect(mockSubmitIssueReport).toHaveBeenCalledWith({
      category: 'ui_bug',
      description: 'Console report',
      appVersion: 'console',
    });
  });
});
