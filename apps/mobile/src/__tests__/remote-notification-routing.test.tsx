import * as Notifications from 'expo-notifications';
import { act, renderHook } from '@testing-library/react-native';

import {
  remoteThreadIdFromNotificationData,
  useRemoteNotificationRouting,
} from '../notifications/remote-routing';

describe('remote notification routing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (Notifications.getLastNotificationResponseAsync as jest.Mock).mockResolvedValue(null);
  });

  it('accepts explicit Remote identifiers and rejects ordinary Chat task identifiers', () => {
    expect(remoteThreadIdFromNotificationData({ remoteThreadId: 'remote-1' })).toBe('remote-1');
    expect(remoteThreadIdFromNotificationData({ surface: 'remote', threadId: 'remote-2' })).toBe('remote-2');
    expect(remoteThreadIdFromNotificationData({ type: 'desktop.needs_input', threadId: 'remote-3' })).toBe('remote-3');
    expect(remoteThreadIdFromNotificationData({ type: 'task.completed', threadId: 'chat-1' })).toBeNull();
  });

  it('opens the Remote surface when a notification response is received', async () => {
    let listener: ((response: Notifications.NotificationResponse) => void) | undefined;
    const remove = jest.fn();
    (Notifications.addNotificationResponseReceivedListener as jest.Mock).mockImplementation(
      (nextListener: (response: Notifications.NotificationResponse) => void) => {
        listener = nextListener;
        return { remove };
      }
    );
    const onOpenThread = jest.fn();
    const { unmount } = await renderHook(() => useRemoteNotificationRouting(onOpenThread));

    await act(async () => {
      listener?.({
        notification: {
          request: { content: { data: { surface: 'remote', threadId: 'thread-9' } } },
        },
      } as Notifications.NotificationResponse);
    });

    expect(onOpenThread).toHaveBeenCalledWith('thread-9');
    await act(async () => unmount());
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
