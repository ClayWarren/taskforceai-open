import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockConfigure = jest.fn();
const mockAddCustomerInfoUpdateListener = jest.fn();
const mockLogIn = jest.fn(async () => ({ customerInfo: {} }));
const mockLogOut = jest.fn(async () => undefined);

jest.mock('react-native-purchases', () => ({
  __esModule: true,
  default: {
    configure: mockConfigure,
    addCustomerInfoUpdateListener: mockAddCustomerInfoUpdateListener,
    logIn: mockLogIn,
    logOut: mockLogOut,
  },
}));

jest.mock('../config/billing', () => ({
  billingConfig: {
    revenueCatIosApiKey: 'ios-test-key',
    revenueCatAndroidApiKey: 'android-test-key',
  },
}));

jest.mock('../logger', () => ({
  createModuleLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

const { configureRevenueCat, requirePurchasesModule } = require('../billing/revenuecat');

describe('RevenueCat configuration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('attaches the customer-info listener when a purchase call auto-configures first', async () => {
    requirePurchasesModule();
    await configureRevenueCat('user-1');

    expect(mockConfigure).toHaveBeenCalledTimes(1);
    expect(mockAddCustomerInfoUpdateListener).toHaveBeenCalledTimes(1);
    expect(mockLogIn).toHaveBeenCalledWith('user-1');
  });
});
