import { describe, expect, it } from 'bun:test';

import { isDesktopPairingDeepLink } from '../../desktop-pairing/deep-link';

describe('desktop pairing deep link', () => {
  it('recognizes desktop pairing links', () => {
    expect(isDesktopPairingDeepLink('taskforceai://desktop-pairing?payload=x')).toBe(true);
    expect(isDesktopPairingDeepLink('taskforceai:///desktop-pairing?payload=x')).toBe(true);
    expect(isDesktopPairingDeepLink('taskforceai://remote/pair?code=ABCD-EFGH')).toBe(true);
  });

  it('ignores unrelated or invalid links', () => {
    expect(isDesktopPairingDeepLink('https://taskforceai.chat')).toBe(false);
    expect(isDesktopPairingDeepLink('taskforceai://settings')).toBe(false);
    expect(isDesktopPairingDeepLink('not a url')).toBe(false);
  });
});
