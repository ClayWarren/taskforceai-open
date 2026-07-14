import { describe, expect, it } from 'bun:test';

import { type PlatformGlobals, detectPlatform } from './detectPlatform';

describe('voice/detectPlatform', () => {
  it('returns desktop when window has __TAURI__', () => {
    const globals: PlatformGlobals = {
      window: { __TAURI__: {} },
      document: {},
    };

    const result = detectPlatform(globals);
    expect(result).toBe('desktop');
  });

  it('returns desktop when Tauri IPC marker exists', () => {
    const globals: PlatformGlobals = {
      window: { __TAURI_IPC__: {} },
      document: {},
    };

    const result = detectPlatform(globals);
    expect(result).toBe('desktop');
  });

  it('returns desktop when TaskForce Tauri readiness flag exists', () => {
    const globals: PlatformGlobals = {
      window: { __TASKFORCE_TAURI_READY: true },
      document: {},
    };

    const result = detectPlatform(globals);
    expect(result).toBe('desktop');
  });

  it('returns desktop when user agent identifies Tauri', () => {
    const globals: PlatformGlobals = {
      window: {},
      document: {},
      navigator: { userAgent: 'Mozilla/5.0 Tauri' },
    };

    const result = detectPlatform(globals);
    expect(result).toBe('desktop');
  });

  it('returns web when window and document exist but no Tauri', () => {
    const globals: PlatformGlobals = {
      window: {},
      document: {},
    };

    const result = detectPlatform(globals);
    expect(result).toBe('web');
  });

  it('returns mobile when navigator userAgent contains reactnative', () => {
    const globals: PlatformGlobals = {
      navigator: { userAgent: 'Mozilla/5.0 ReactNative' },
    };

    const result = detectPlatform(globals);
    expect(result).toBe('mobile');
  });

  it('returns mobile when HermesInternal exists', () => {
    const globals: PlatformGlobals = {
      hasHermesInternal: true,
    };

    const result = detectPlatform(globals);
    expect(result).toBe('mobile');
  });

  it('returns unknown when no platform indicators exist', () => {
    const globals: PlatformGlobals = {};

    const result = detectPlatform(globals);
    expect(result).toBe('unknown');
  });

  it('returns unknown when navigator exists but userAgent is not reactnative', () => {
    const globals: PlatformGlobals = {
      navigator: { userAgent: 'Mozilla/5.0 Chrome' },
    };

    const result = detectPlatform(globals);
    expect(result).toBe('unknown');
  });

  it('handles undefined userAgent in navigator', () => {
    const globals: PlatformGlobals = {
      navigator: {},
    };

    const result = detectPlatform(globals);
    expect(result).toBe('unknown');
  });

  it('handles window without document', () => {
    const globals: PlatformGlobals = {
      window: {},
    };

    const result = detectPlatform(globals);
    expect(result).toBe('unknown');
  });

  it('uses default globals when no argument provided', () => {
    // This test ensures the default parameter path is exercised
    const result = detectPlatform();
    expect(['web', 'mobile', 'desktop', 'unknown']).toContain(result);
  });

  it('prefers desktop over web when Tauri is present', () => {
    const globals: PlatformGlobals = {
      window: { __TAURI__: { version: '1.0' } },
      document: {},
    };

    const result = detectPlatform(globals);
    expect(result).toBe('desktop');
  });

  it('returns unknown when hasHermesInternal is false', () => {
    const globals: PlatformGlobals = {
      hasHermesInternal: false,
    };

    const result = detectPlatform(globals);
    expect(result).toBe('unknown');
  });
});
