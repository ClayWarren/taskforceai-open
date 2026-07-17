import * as SecureStore from 'expo-secure-store';

/** Persistent sessions for the Desktop Work pairing feature. */

import { desktopPairingSessionSchema } from './client';
import type { DesktopPairingSession } from './client';

const DESKTOP_PAIRING_SESSION_KEY = 'taskforceai_desktop_pairing_session';
const DESKTOP_PAIRING_HOSTS_KEY = 'taskforceai_desktop_pairing_hosts_v2';

export type DesktopPairingHost = {
  id: string;
  name: string;
  session: DesktopPairingSession;
  lastConnectedAt: number;
};

type DesktopPairingHostsState = {
  activeHostId: string | null;
  hosts: DesktopPairingHost[];
};

export const readDesktopPairingSession = async (): Promise<DesktopPairingSession | null> => {
  const state = await readHostsState();
  const active = state.hosts.find((host) => host.id === state.activeHostId);
  if (active) return active.session;
  const value = await SecureStore.getItemAsync(DESKTOP_PAIRING_SESSION_KEY);
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (isDesktopPairingSession(parsed)) {
      await saveDesktopPairingSession(parsed);
      return parsed;
    }
  } catch {
    // Bad local state is recoverable; clear it and let the user pair again.
  }
  await clearDesktopPairingSession();
  return null;
};

export const readDesktopPairingHosts = async (): Promise<DesktopPairingHost[]> =>
  (await readHostsState()).hosts;

export const saveDesktopPairingSession = async (
  session: DesktopPairingSession,
  name?: string
): Promise<void> => {
  const state = await readHostsState();
  const id = desktopHostId(session);
  const host: DesktopPairingHost = {
    id,
    name: name?.trim() || desktopHostName(session.baseUrl),
    session,
    lastConnectedAt: Date.now(),
  };
  const hosts = [...state.hosts.filter((candidate) => candidate.id !== id), host];
  await Promise.all([
    writeHostsState({ activeHostId: id, hosts }),
    SecureStore.setItemAsync(DESKTOP_PAIRING_SESSION_KEY, JSON.stringify(session)),
  ]);
};

export const selectDesktopPairingHost = async (hostId: string): Promise<DesktopPairingSession> => {
  const state = await readHostsState();
  const host = state.hosts.find((candidate) => candidate.id === hostId);
  if (!host) throw new Error('Saved desktop host was not found.');
  await Promise.all([
    writeHostsState({ ...state, activeHostId: hostId }),
    SecureStore.setItemAsync(DESKTOP_PAIRING_SESSION_KEY, JSON.stringify(host.session)),
  ]);
  return host.session;
};

export const clearDesktopPairingSession = async (): Promise<void> => {
  const state = await readHostsState();
  const hosts = state.hosts.filter((host) => host.id !== state.activeHostId);
  const next = hosts.at(-1) ?? null;
  await writeHostsState({ activeHostId: next?.id ?? null, hosts });
  if (next) {
    await SecureStore.setItemAsync(DESKTOP_PAIRING_SESSION_KEY, JSON.stringify(next.session));
  } else {
    await SecureStore.deleteItemAsync(DESKTOP_PAIRING_SESSION_KEY);
  }
};

export const clearAllDesktopPairingSessions = async (): Promise<void> => {
  await Promise.all([
    SecureStore.deleteItemAsync(DESKTOP_PAIRING_SESSION_KEY),
    SecureStore.deleteItemAsync(DESKTOP_PAIRING_HOSTS_KEY),
  ]);
};

const readHostsState = async (): Promise<DesktopPairingHostsState> => {
  const value = await SecureStore.getItemAsync(DESKTOP_PAIRING_HOSTS_KEY);
  if (!value) return { activeHostId: null, hosts: [] };
  try {
    const parsed = JSON.parse(value) as Partial<DesktopPairingHostsState>;
    const hosts = Array.isArray(parsed.hosts)
      ? parsed.hosts.filter(isDesktopPairingHost)
      : [];
    const activeHostId =
      typeof parsed.activeHostId === 'string' && hosts.some((host) => host.id === parsed.activeHostId)
        ? parsed.activeHostId
        : (hosts.at(-1)?.id ?? null);
    return { activeHostId, hosts };
  } catch {
    await SecureStore.deleteItemAsync(DESKTOP_PAIRING_HOSTS_KEY);
    return { activeHostId: null, hosts: [] };
  }
};

const writeHostsState = (state: DesktopPairingHostsState): Promise<void> =>
  SecureStore.setItemAsync(DESKTOP_PAIRING_HOSTS_KEY, JSON.stringify(state));

const isDesktopPairingHost = (value: unknown): value is DesktopPairingHost => {
  if (!value || typeof value !== 'object') return false;
  const host = value as Partial<DesktopPairingHost>;
  return (
    typeof host.id === 'string' &&
    typeof host.name === 'string' &&
    typeof host.lastConnectedAt === 'number' &&
    isDesktopPairingSession(host.session)
  );
};

const desktopHostId = (session: DesktopPairingSession): string => session.baseUrl.toLowerCase();

const desktopHostName = (baseUrl: string): string => {
  try {
    return new URL(baseUrl).hostname || 'Desktop';
  } catch {
    return 'Desktop';
  }
};

const isDesktopPairingSession = (value: unknown): value is DesktopPairingSession => {
  const parsed = desktopPairingSessionSchema.safeParse(value);
  if (!parsed.success) {
    return false;
  }
  return isSafeStoredSession(parsed.data);
};

const isSafeStoredSession = (session: DesktopPairingSession): boolean => {
  if (session.transport.kind === 'relay') {
    return Boolean(
      session.targetDeviceId &&
        session.controllerDeviceId &&
        session.deviceCredential &&
        session.machineName
    );
  }
  try {
    const baseUrl = new URL(session.baseUrl);
    const rpcUrl = new URL(session.rpcPath, 'http://desktop.local');
    return (
      (baseUrl.protocol === 'http:' || baseUrl.protocol === 'https:') &&
      session.rpcPath.startsWith('/') &&
      !session.rpcPath.startsWith('//') &&
      rpcUrl.origin === 'http://desktop.local' &&
      rpcUrl.hash === ''
    );
  } catch {
    return false;
  }
};
