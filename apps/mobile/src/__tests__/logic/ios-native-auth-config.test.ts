import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const mobileRoot = resolve(import.meta.dir, '../../..');
const easConfigPath = resolve(mobileRoot, 'eas.json');
const appConfigPath = resolve(mobileRoot, 'app.config.js');
const taskforceScheme = 'taskforceai';
const iosGoogleClientId = '40158904703-vcvod9am4pt2resef8io6b3a1rdnsh1u.apps.googleusercontent.com';
const iosGoogleScheme = 'com.googleusercontent.apps.40158904703-vcvod9am4pt2resef8io6b3a1rdnsh1u';

const loadProductionAppConfig = async () => {
  process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID = iosGoogleClientId;
  const { default: makeConfig } = await import(`${appConfigPath}?test=${Date.now()}`);
  return makeConfig({ config: { extra: {} } });
};

describe('iOS native auth configuration', () => {
  it('registers OAuth callback schemes in the tracked Expo config', async () => {
    const config = await loadProductionAppConfig();

    expect(config.scheme).toBe(taskforceScheme);
    expect(config.ios.infoPlist.CFBundleURLTypes).toContainEqual({
      CFBundleURLSchemes: [taskforceScheme],
    });
    expect(config.ios.infoPlist.CFBundleURLTypes).toContainEqual({
      CFBundleURLSchemes: [iosGoogleScheme],
    });
  });

  it('keeps the production EAS env aligned with the iOS Google OAuth scheme', () => {
    const easConfig = JSON.parse(readFileSync(easConfigPath, 'utf8'));

    expect(easConfig.build.production.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID).toBe(iosGoogleClientId);
  });

  it('keeps the App Store build and Apple sign-in plugin configured', async () => {
    const config = await loadProductionAppConfig();

    expect(config.ios.bundleIdentifier).toBe('com.taskforceai.mobile');
    expect(config.version).toBe('0.9.0');
    expect(config.ios.buildNumber).toBe('49');
    expect(config.ios.supportsTablet).toBe(true);
    expect(config.plugins).toContain('expo-apple-authentication');
  });
});
