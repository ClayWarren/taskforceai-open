import { describe, expect, it, mock } from 'bun:test';

import { authorizeDeviceCode } from '@taskforceai/api-client/api/auth';
import { authorizeDeviceLogin } from './auth-actions';

// Mock the API module
mock.module('@taskforceai/api-client/api/auth', () => ({
  authorizeDeviceCode: mock(),
}));

describe('Auth Actions', () => {
  describe('authorizeDeviceLogin', () => {
    it('delegates to authorizeDeviceCode', async () => {
      const mockResult = { status: 'success' } as const;
      (authorizeDeviceCode as any).mockResolvedValue(mockResult);

      const result = await authorizeDeviceLogin('ABCD-1234');
      expect(result).toBe(mockResult);
      expect(authorizeDeviceCode).toHaveBeenCalledWith('ABCD-1234');
    });
  });
});
