import { afterEach, describe, expect, it } from 'bun:test';

import { createMarketingEnv } from './env';

const originalIosUrl = process.env['NEXT_PUBLIC_MOBILE_IOS_APP_URL'];
const originalAndroidUrl = process.env['NEXT_PUBLIC_MOBILE_ANDROID_APP_URL'];

afterEach(() => {
  process.env['NEXT_PUBLIC_MOBILE_IOS_APP_URL'] = originalIosUrl;
  process.env['NEXT_PUBLIC_MOBILE_ANDROID_APP_URL'] = originalAndroidUrl;
});

describe('createMarketingEnv', () => {
  it('reads the mobile public URLs from the runtime environment', () => {
    process.env['NEXT_PUBLIC_MOBILE_IOS_APP_URL'] =
      'https://apps.apple.com/us/app/taskforceai/id6754827533';
    process.env['NEXT_PUBLIC_MOBILE_ANDROID_APP_URL'] =
      'https://play.google.com/store/apps/details?id=chat.taskforceai';

    expect(createMarketingEnv()).toEqual({
      NEXT_PUBLIC_MOBILE_IOS_APP_URL: 'https://apps.apple.com/us/app/taskforceai/id6754827533',
      NEXT_PUBLIC_MOBILE_ANDROID_APP_URL:
        'https://play.google.com/store/apps/details?id=chat.taskforceai',
    });
  });

  it('leaves unset URLs undefined for downstream fallback handling', () => {
    delete process.env['NEXT_PUBLIC_MOBILE_IOS_APP_URL'];
    delete process.env['NEXT_PUBLIC_MOBILE_ANDROID_APP_URL'];

    expect(createMarketingEnv()).toEqual({
      NEXT_PUBLIC_MOBILE_IOS_APP_URL: undefined,
      NEXT_PUBLIC_MOBILE_ANDROID_APP_URL: undefined,
    });
  });

  it('falls back cleanly when process.env is unavailable', () => {
    const originalProcessEnv = process.env;
    try {
      Object.defineProperty(process, 'env', { value: undefined, configurable: true });

      expect(createMarketingEnv()).toEqual({
        NEXT_PUBLIC_MOBILE_IOS_APP_URL: undefined,
        NEXT_PUBLIC_MOBILE_ANDROID_APP_URL: undefined,
      });
    } finally {
      Object.defineProperty(process, 'env', { value: originalProcessEnv, configurable: true });
    }
  });
});
