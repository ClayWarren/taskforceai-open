import { describe, expect, it, vi } from 'bun:test';

vi.mock('@taskforceai/presenters/utils/text', () => ({
  buildRateLimitUpgradeMessage: vi.fn((plan?: string | null) =>
    plan ? `Upgrade to ${plan} for higher limits` : 'Upgrade for higher limits'
  ),
  readFileContent: vi.fn().mockResolvedValue('file content'),
}));

import { getRateLimitResetTime, getRateLimitMessage } from './prompt-submission';
import { buildRateLimitUpgradeMessage } from '@taskforceai/presenters/utils/text';

describe('prompt-submission', () => {
  describe('getRateLimitResetTime', () => {
    it('returns resetTime when present', () => {
      const error = { resetTime: '2024-01-01T00:00:00Z' };
      expect(getRateLimitResetTime(error)).toBe('2024-01-01T00:00:00Z');
    });

    it('returns undefined when resetTime is missing', () => {
      const error = {};
      expect(getRateLimitResetTime(error)).toBeUndefined();
    });
  });

  describe('getRateLimitMessage', () => {
    it('calls buildRateLimitUpgradeMessage with plan', () => {
      getRateLimitMessage('pro');
      expect(buildRateLimitUpgradeMessage).toHaveBeenCalledWith('pro');
    });

    it('calls buildRateLimitUpgradeMessage without plan', () => {
      getRateLimitMessage();
      expect(buildRateLimitUpgradeMessage).toHaveBeenCalledWith(undefined);
    });

    it('calls buildRateLimitUpgradeMessage with null plan', () => {
      getRateLimitMessage(null);
      expect(buildRateLimitUpgradeMessage).toHaveBeenCalledWith(null);
    });
  });
});
