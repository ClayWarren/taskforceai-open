import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import {
  detectRuntime,
  initializeDesktopRuntime,
  isBrowserRuntime,
  isDesktopRuntime,
} from './runtime';

const globalScope = globalThis as Record<string, unknown>;

let previousWindow: unknown;
let previousNavigator: unknown;

const restoreGlobal = (name: string, value: unknown): void => {
  if (value === undefined) {
    delete globalScope[name];
    return;
  }
  globalScope[name] = value;
};

describe('shared-ts/utils/runtime', () => {
  beforeEach(() => {
    previousWindow = globalScope['window'];
    previousNavigator = globalScope['navigator'];
  });

  afterEach(() => {
    restoreGlobal('window', previousWindow);
    restoreGlobal('navigator', previousNavigator);
  });

  it('returns browser when Tauri globals are not present', () => {
    globalScope['window'] = {};
    globalScope['navigator'] = { userAgent: 'Mozilla/5.0' };

    expect(detectRuntime()).toBe('browser');
    expect(isBrowserRuntime()).toBe(true);
    expect(isDesktopRuntime()).toBe(false);
  });

  it('returns server when window is unavailable', () => {
    delete globalScope['window'];
    globalScope['navigator'] = { userAgent: 'Tauri/2.0' };

    expect(detectRuntime()).toBe('server');
    expect(isBrowserRuntime()).toBe(false);
    expect(isDesktopRuntime()).toBe(false);
  });

  it('detects desktop runtime from Tauri globals and user agent markers', () => {
    globalScope['navigator'] = { userAgent: 'Mozilla/5.0' };

    globalScope['window'] = { __TAURI__: {} };
    expect(detectRuntime()).toBe('desktop');

    globalScope['window'] = { __TAURI_IPC__: () => undefined };
    expect(detectRuntime()).toBe('desktop');

    globalScope['window'] = {};
    globalScope['navigator'] = { userAgent: 'TaskForceAI Tauri/2.0' };
    expect(detectRuntime()).toBe('desktop');
  });

  it('does not initialize desktop-only runtime hooks outside desktop', () => {
    globalScope['window'] = {};
    globalScope['navigator'] = { userAgent: 'Mozilla/5.0' };

    let callCount = 0;
    initializeDesktopRuntime(() => {
      callCount += 1;
    });

    expect(callCount).toBe(0);
  });

  it('promotes runtime from browser to desktop after Tauri flag appears', () => {
    globalScope['window'] = {};
    globalScope['navigator'] = { userAgent: 'Mozilla/5.0' };

    expect(detectRuntime()).toBe('browser');

    const windowRecord = globalScope['window'] as Record<string, unknown>;
    windowRecord['__TASKFORCE_TAURI_READY'] = true;

    expect(detectRuntime()).toBe('desktop');
    expect(isDesktopRuntime()).toBe(true);
  });

  it('initializes desktop runtime callback once', () => {
    globalScope['window'] = {
      __TASKFORCE_TAURI_READY: true,
    };
    globalScope['navigator'] = { userAgent: 'Mozilla/5.0' };

    let callCount = 0;
    const onInitialize = () => {
      callCount += 1;
    };

    initializeDesktopRuntime(onInitialize);
    initializeDesktopRuntime(onInitialize);
    expect(callCount).toBe(1);
  });
});
