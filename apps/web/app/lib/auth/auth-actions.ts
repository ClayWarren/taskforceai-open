import { type DeviceAuthorizeResult, authorizeDeviceCode } from '@taskforceai/api-client/api/auth';

/**
 * Authorize a device login code.
 */
export const authorizeDeviceLogin = async (userCode: string): Promise<DeviceAuthorizeResult> => {
  return authorizeDeviceCode(userCode);
};
