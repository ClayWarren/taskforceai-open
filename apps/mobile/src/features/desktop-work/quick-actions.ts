import AsyncStorage from '@react-native-async-storage/async-storage';
import * as QuickActions from 'expo-quick-actions';

import type { DesktopThread } from './data/desktop-work';

const RECENTS_KEY = '@taskforceai:remote-quick-action-recents:v1';
const MAX_RECENTS = 3;

type RemoteQuickActionRecent = {
  hostId: string;
  threadId: string;
  title: string;
};

export const configureRemoteQuickActions = async (): Promise<void> => {
  if (!await QuickActions.isSupported()) return;
  const recents = await readRecents();
  await QuickActions.setItems([
    {
      id: 'remote-new-task',
      title: 'New Remote task',
      icon: 'compose',
      params: { href: '/remote/new' },
    },
    ...recents.map((recent) => ({
      id: `remote:${encodeURIComponent(recent.hostId)}:${encodeURIComponent(recent.threadId)}`,
      title: recent.title.trim() || 'Remote task',
      subtitle: 'Continue on Mac',
      icon: 'task',
      params: {
        href: `/remote/open?hostId=${encodeURIComponent(recent.hostId)}&threadId=${encodeURIComponent(recent.threadId)}`,
      },
    })),
  ]);
};

export const recordRemoteQuickAction = async (thread: DesktopThread): Promise<void> => {
  if (!thread.hostId) return;
  const recents = await readRecents();
  const next = [
    { hostId: thread.hostId, threadId: thread.id, title: thread.title },
    ...recents.filter(
      (recent) => recent.hostId !== thread.hostId || recent.threadId !== thread.id
    ),
  ].slice(0, MAX_RECENTS);
  await AsyncStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  await configureRemoteQuickActions();
};

const readRecents = async (): Promise<RemoteQuickActionRecent[]> => {
  const raw = await AsyncStorage.getItem(RECENTS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter(isRemoteQuickActionRecent).slice(0, MAX_RECENTS)
      : [];
  } catch {
    return [];
  }
};

const isRemoteQuickActionRecent = (value: unknown): value is RemoteQuickActionRecent => {
  if (!value || typeof value !== 'object') return false;
  const recent = value as Partial<RemoteQuickActionRecent>;
  return typeof recent.hostId === 'string'
    && recent.hostId.trim().length > 0
    && typeof recent.threadId === 'string'
    && recent.threadId.trim().length > 0
    && typeof recent.title === 'string';
};
