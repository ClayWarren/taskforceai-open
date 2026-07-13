import { describe, expect, it } from '@jest/globals';

import { isNetworkStateOnline } from '../../hooks/useNetworkStatus.logic';

describe('isNetworkStateOnline', () => {
  it('requires a connection and rejects known-unreachable networks', () => {
    expect(isNetworkStateOnline({ isConnected: true, isInternetReachable: true })).toBe(true);
    expect(isNetworkStateOnline({ isConnected: true, isInternetReachable: null })).toBe(true);
    expect(isNetworkStateOnline({ isConnected: true, isInternetReachable: false })).toBe(false);
    expect(isNetworkStateOnline({ isConnected: false, isInternetReachable: true })).toBe(false);
    expect(isNetworkStateOnline({ isConnected: null, isInternetReachable: null })).toBe(false);
  });
});
