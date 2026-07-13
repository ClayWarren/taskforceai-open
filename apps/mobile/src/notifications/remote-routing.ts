import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';

type NotificationData = Record<string, unknown>;

export const remoteThreadIdFromNotificationData = (data: NotificationData): string | null => {
  const explicitId = data.remoteThreadId ?? data.desktopThreadId;
  if (typeof explicitId === 'string' && explicitId.trim()) return explicitId.trim();
  const isRemote =
    data.surface === 'remote' ||
    data.source === 'desktop' ||
    (typeof data.type === 'string' && /^(remote|desktop)[._-]/i.test(data.type));
  return isRemote && typeof data.threadId === 'string' && data.threadId.trim()
    ? data.threadId.trim()
    : null;
};

const threadIdFromResponse = (
  response: Notifications.NotificationResponse | null | undefined
): string | null => {
  const data = response?.notification.request.content.data;
  return data && typeof data === 'object'
    ? remoteThreadIdFromNotificationData(data as NotificationData)
    : null;
};

export function useRemoteNotificationRouting(onOpenThread: (threadId: string) => void) {
  useEffect(() => {
    let active = true;
    void Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        const threadId = threadIdFromResponse(response);
        if (active && threadId) onOpenThread(threadId);
      })
      .catch(() => undefined);

    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const threadId = threadIdFromResponse(response);
      if (threadId) onOpenThread(threadId);
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, [onOpenThread]);
}
