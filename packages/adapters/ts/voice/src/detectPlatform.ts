import type { VoicePlatform } from './types';

export interface PlatformGlobals {
  window?:
    | {
        __TAURI__?: unknown;
        __TAURI_IPC__?: unknown;
        __TASKFORCE_TAURI_READY?: boolean;
      }
    | undefined;
  document?: unknown;
  navigator?: { userAgent?: string } | undefined;
  hasHermesInternal?: boolean;
}

const getDefaultGlobals = (): PlatformGlobals => ({
  window:
    typeof window !== 'undefined'
      ? (window as unknown as NonNullable<PlatformGlobals['window']>)
      : undefined,
  document: typeof document !== 'undefined' ? document : undefined,
  navigator:
    typeof navigator !== 'undefined' ? (navigator as unknown as { userAgent?: string }) : undefined,
  hasHermesInternal:
    typeof globalThis !== 'undefined' &&
    Object.prototype.hasOwnProperty.call(globalThis, 'HermesInternal'),
});

export const detectPlatform = (globals: PlatformGlobals = getDefaultGlobals()): VoicePlatform => {
  if (globals.window !== undefined) {
    const hasTauri =
      globals.window.__TASKFORCE_TAURI_READY === true ||
      globals.window.__TAURI__ !== undefined ||
      globals.window.__TAURI_IPC__ !== undefined ||
      /Tauri/i.test(globals.navigator?.userAgent ?? '');
    if (hasTauri) {
      return 'desktop';
    }
    if (globals.document !== undefined) {
      return 'web';
    }
  }

  if (globals.navigator !== undefined) {
    const userAgent = globals.navigator.userAgent ?? '';
    if (typeof userAgent === 'string' && userAgent.toLowerCase().includes('reactnative')) {
      return 'mobile';
    }
  }

  if (globals.hasHermesInternal) {
    return 'mobile';
  }

  return 'unknown';
};
