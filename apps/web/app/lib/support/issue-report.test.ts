import { beforeEach, describe, expect, it, vi } from 'bun:test';

// Import after mocking
import { submitIssueReport, submitIssueReportWithVersion } from './issue-report';

// Mock dependencies using vi.mock with wrapper functions
const mockReportIssue = vi.fn();
const mockReadClientMetadata = vi.fn();

vi.mock('@taskforceai/contracts/api/support', () => ({
  reportIssue: (...args: unknown[]) => mockReportIssue(...args),
}));

vi.mock('@taskforceai/contracts/services/client-metadata', () => ({
  readClientMetadata: () => mockReadClientMetadata(),
}));

describe('issue-report', () => {
  beforeEach(() => {
    mockReportIssue.mockReset();
    mockReadClientMetadata.mockReset();
    mockReadClientMetadata.mockReturnValue({
      ok: true,
      value: { locale: 'en-US', timezone: 'America/New_York', platform: 'MacIntel' },
    });
  });

  describe('submitIssueReport', () => {
    it('submits issue report successfully', async () => {
      mockReportIssue.mockResolvedValue(undefined);

      const result = await submitIssueReport({
        category: 'ui_bug',
        description: 'Test description',
      });

      expect(result.ok).toBe(true);
      expect(mockReportIssue).toHaveBeenCalled();
      const calledArgs = mockReportIssue.mock.calls[0]![0];
      expect(calledArgs.category).toBe('ui_bug');
      expect(calledArgs.description).toBe('Test description');
      expect(calledArgs.metadata.locale).toBe('en-US');
      expect(calledArgs.metadata.timezone).toBe('America/New_York');
      expect(calledArgs.metadata.platform).toBe('MacIntel');
    });

    it('includes conversation context when provided', async () => {
      mockReportIssue.mockResolvedValue(undefined);

      await submitIssueReport({
        category: 'feature_request',
        description: 'Test',
        context: {
          conversationId: 'conv-123',
          lastMessagePreview: 'Last message preview',
        },
      });

      const calledArgs = mockReportIssue.mock.calls[0]![0];
      expect(calledArgs.metadata.conversationId).toBe('conv-123');
      expect(calledArgs.metadata.latestMessagePreview).toBe('Last message preview');
    });

    it('truncates long message previews to 280 characters', async () => {
      mockReportIssue.mockResolvedValue(undefined);
      const longMessage = 'x'.repeat(500);

      await submitIssueReport({
        category: 'ui_bug',
        description: 'Test',
        context: {
          lastMessagePreview: longMessage,
        },
      });

      const calledMetadata = mockReportIssue.mock.calls[0]![0].metadata;
      expect(calledMetadata.latestMessagePreview.length).toBe(280);
    });

    it('handles client metadata read failure gracefully', async () => {
      mockReadClientMetadata.mockReturnValue({
        ok: false,
        error: { kind: 'unavailable', message: 'Not available' },
      });
      mockReportIssue.mockResolvedValue(undefined);

      const result = await submitIssueReport({
        category: 'ui_bug',
        description: 'Test',
      });

      expect(result.ok).toBe(true);
      expect(mockReportIssue).toHaveBeenCalled();
    });

    it('returns error when report submission fails', async () => {
      mockReportIssue.mockRejectedValue(new Error('Network error'));

      const result = await submitIssueReport({
        category: 'ui_bug',
        description: 'Test',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('submit_failed');
        expect(result.error.message).toBe('Network error');
      }
    });

    it('returns default error message for non-Error throws', async () => {
      mockReportIssue.mockRejectedValue('string error');

      const result = await submitIssueReport({
        category: 'ui_bug',
        description: 'Test',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('submit_failed');
        expect(result.error.message).toBe('Unable to submit report');
      }
    });

    it('does not include conversationId when null', async () => {
      mockReportIssue.mockResolvedValue(undefined);

      await submitIssueReport({
        category: 'ui_bug',
        description: 'Test',
        context: {
          conversationId: null,
        },
      });

      const calledMetadata = mockReportIssue.mock.calls[0]![0].metadata;
      expect(calledMetadata.conversationId).toBeUndefined();
    });

    it('does not include lastMessagePreview when not provided', async () => {
      mockReportIssue.mockResolvedValue(undefined);

      await submitIssueReport({
        category: 'ui_bug',
        description: 'Test',
        context: {
          conversationId: 'conv-123',
        },
      });

      const calledMetadata = mockReportIssue.mock.calls[0]![0].metadata;
      expect(calledMetadata.latestMessagePreview).toBeUndefined();
    });
  });

  describe('submitIssueReportWithVersion', () => {
    it('forwards reports with the bundled app version', async () => {
      mockReportIssue.mockResolvedValue(undefined);

      const result = await submitIssueReportWithVersion({
        category: 'ui_bug',
        description: 'Versioned report',
      });

      expect(result.ok).toBe(true);
      expect(mockReportIssue).toHaveBeenCalledTimes(1);
      const calledArgs = mockReportIssue.mock.calls[0]![0];
      expect(calledArgs.category).toBe('ui_bug');
      expect(calledArgs.description).toBe('Versioned report');
      expect(calledArgs.metadata.appVersion).toBe('web');
    });
  });
});
