export type PlatformRuntime = 'browser' | 'desktop' | 'server';

const isTauriEnv = (): boolean => {
  if (typeof window === 'undefined') {
    return false; // coverage-ignore-line -- detectRuntime handles server before calling this helper.
  }

  const globalObject = window as unknown as {
    __TAURI__?: unknown;
    __TAURI_IPC__?: unknown;
    __TASKFORCE_TAURI_READY?: boolean;
  };

  const userAgent =
    typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string'
      ? navigator.userAgent
      : '';

  return (
    Boolean(globalObject.__TASKFORCE_TAURI_READY) ||
    Boolean(globalObject.__TAURI__) ||
    Boolean(globalObject.__TAURI_IPC__) ||
    /Tauri/i.test(userAgent)
  );
};

export const detectRuntime = (): PlatformRuntime => {
  if (typeof window === 'undefined') {
    return 'server';
  }

  return isTauriEnv() ? 'desktop' : 'browser';
};

export const isDesktopRuntime = (): boolean => detectRuntime() === 'desktop';

export const isBrowserRuntime = (): boolean => detectRuntime() === 'browser';

let runtimeInitialized = false;

export const initializeDesktopRuntime = (onInitialize?: () => void): void => {
  if (runtimeInitialized) {
    return;
  }

  if (!isDesktopRuntime()) {
    return;
  }

  onInitialize?.();
  runtimeInitialized = true;
};
