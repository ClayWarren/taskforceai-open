import { Platform } from 'react-native';

import { isGlassEffectSupported } from '../../utils/glass';

describe('glass utils', () => {
  const originalOS = Platform.OS;
  const originalVersion = Platform.Version;

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: originalOS, writable: true });
    Object.defineProperty(Platform, 'Version', { value: originalVersion, writable: true });
  });

  describe('isGlassEffectSupported', () => {
    it('returns false for Android', () => {
      Object.defineProperty(Platform, 'OS', { value: 'android', writable: true });
      Object.defineProperty(Platform, 'Version', { value: 30, writable: true });
      expect(isGlassEffectSupported()).toBe(false);
    });

    it('returns false for web', () => {
      Object.defineProperty(Platform, 'OS', { value: 'web', writable: true });
      expect(isGlassEffectSupported()).toBe(false);
    });

    it('returns true for iOS 17+', () => {
      Object.defineProperty(Platform, 'OS', { value: 'ios', writable: true });
      Object.defineProperty(Platform, 'Version', { value: 17, writable: true });
      expect(isGlassEffectSupported()).toBe(true);
    });

    it('returns true for iOS 18', () => {
      Object.defineProperty(Platform, 'OS', { value: 'ios', writable: true });
      Object.defineProperty(Platform, 'Version', { value: 18, writable: true });
      expect(isGlassEffectSupported()).toBe(true);
    });

    it('returns false for iOS 16', () => {
      Object.defineProperty(Platform, 'OS', { value: 'ios', writable: true });
      Object.defineProperty(Platform, 'Version', { value: 16, writable: true });
      expect(isGlassEffectSupported()).toBe(false);
    });

    it('returns false for iOS below 17', () => {
      Object.defineProperty(Platform, 'OS', { value: 'ios', writable: true });
      Object.defineProperty(Platform, 'Version', { value: 15, writable: true });
      expect(isGlassEffectSupported()).toBe(false);
    });

    it('handles string version for iOS', () => {
      Object.defineProperty(Platform, 'OS', { value: 'ios', writable: true });
      Object.defineProperty(Platform, 'Version', { value: '17.0', writable: true });
      expect(isGlassEffectSupported()).toBe(true);
    });

    it('handles string version below minimum for iOS', () => {
      Object.defineProperty(Platform, 'OS', { value: 'ios', writable: true });
      Object.defineProperty(Platform, 'Version', { value: '16.5', writable: true });
      expect(isGlassEffectSupported()).toBe(false);
    });

    it('handles invalid string version', () => {
      Object.defineProperty(Platform, 'OS', { value: 'ios', writable: true });
      Object.defineProperty(Platform, 'Version', { value: 'invalid', writable: true });
      expect(isGlassEffectSupported()).toBe(false);
    });

    it('handles undefined version', () => {
      Object.defineProperty(Platform, 'OS', { value: 'ios', writable: true });
      Object.defineProperty(Platform, 'Version', { value: undefined, writable: true });
      expect(isGlassEffectSupported()).toBe(false);
    });

    it('handles object version', () => {
      Object.defineProperty(Platform, 'OS', { value: 'ios', writable: true });
      Object.defineProperty(Platform, 'Version', { value: {} as any, writable: true });
      expect(isGlassEffectSupported()).toBe(false);
    });
  });
});
