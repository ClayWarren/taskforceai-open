describe('mobile billing config', () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock('expo-constants');
  });

  it('reads configured billing values from Expo extra data', () => {
    jest.doMock('expo-constants', () => ({
      __esModule: true,
      default: {
        expoConfig: {
          extra: {
            billing: {
              revenueCatIosApiKey: 'ios-key',
              entitlementPro: 'configured-pro',
            },
          },
        },
      },
    }));

    const { billingConfig } = require('../config/billing');

    expect(billingConfig.revenueCatIosApiKey).toBe('ios-key');
    expect(billingConfig.entitlementPro).toBe('configured-pro');
    expect(billingConfig.entitlementSuper).toBe('super');
  });
});
