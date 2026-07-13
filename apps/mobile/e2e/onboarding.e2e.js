describe('Onboarding flow', () => {
  beforeEach(async () => {
    await device.launchApp({
      newInstance: true,
      delete: true,
      ...(process.env.EXPO_DETOX_URL ? { url: process.env.EXPO_DETOX_URL } : {}),
    });
  });

  it('shows the login screen when the header login CTA is tapped', async () => {
    await element(by.id('header-login-button')).tap();
    await expect(element(by.id('login-google-button'))).toBeVisible();
  });
});
