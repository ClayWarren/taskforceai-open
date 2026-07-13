import { beforeEach, describe, expect, it } from 'bun:test';
import { Linking } from 'react-native';

import { getInitialUrl, subscribeUrlEvents } from '../../desktop-pairing/linking';

type MockFn = {
  mockResolvedValueOnce: (value: unknown) => void;
  mockReturnValueOnce: (value: unknown) => void;
};

describe('desktop pairing linking', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('delegates initial URL reads to React Native Linking', async () => {
    const initialUrl = 'taskforceai://desktop-pairing?payload=fresh';
    (Linking.getInitialURL as unknown as MockFn).mockResolvedValueOnce(initialUrl);

    await expect(getInitialUrl()).resolves.toBe(initialUrl);
    expect(Linking.getInitialURL).toHaveBeenCalledTimes(1);
  });

  it('subscribes to React Native URL events', () => {
    const handler = jest.fn();
    const subscription = { remove: jest.fn() };
    (Linking.addEventListener as unknown as MockFn).mockReturnValueOnce(subscription);

    expect(subscribeUrlEvents(handler)).toBe(subscription);
    expect(Linking.addEventListener).toHaveBeenCalledWith('url', handler);
  });
});
