import AsyncStorage from '@react-native-async-storage/async-storage';
import * as QuickActions from 'expo-quick-actions';

import { configureRemoteQuickActions } from '../../../features/desktop-work/quick-actions';

jest.mock('expo-quick-actions', () => ({
  isSupported: jest.fn(),
  setItems: jest.fn(),
}));

const RECENTS_KEY = '@taskforceai:remote-quick-action-recents:v1';

describe('Remote quick actions', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    jest.mocked(QuickActions.isSupported).mockResolvedValue(true);
    jest.mocked(QuickActions.setItems).mockResolvedValue();
  });

  it('omits persisted recents that cannot identify a host and thread', async () => {
    await AsyncStorage.setItem(
      RECENTS_KEY,
      JSON.stringify([
        { hostId: '', threadId: 'thread-without-host', title: 'Missing host' },
        { hostId: 'host-without-thread', threadId: '  ', title: 'Missing thread' },
        { hostId: 'host/a', threadId: 'thread ?1', title: 'Resume work' },
      ])
    );

    await configureRemoteQuickActions();

    expect(QuickActions.setItems).toHaveBeenCalledWith([
      {
        id: 'remote-new-task',
        title: 'New Remote task',
        icon: 'compose',
        params: { href: '/remote/new' },
      },
      {
        id: 'remote:host%2Fa:thread%20%3F1',
        title: 'Resume work',
        subtitle: 'Continue on Mac',
        icon: 'task',
        params: { href: '/remote/open?hostId=host%2Fa&threadId=thread%20%3F1' },
      },
    ]);
  });

  it('does not read or publish shortcuts when native quick actions are unavailable', async () => {
    jest.mocked(QuickActions.isSupported).mockResolvedValue(false);

    await configureRemoteQuickActions();

    expect(AsyncStorage.getItem).not.toHaveBeenCalled();
    expect(QuickActions.setItems).not.toHaveBeenCalled();
  });
});
