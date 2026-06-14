import { describe, expect, it, mock, beforeEach } from 'bun:test';

const mockEnv = {
  mobileEnv: {
    nodeEnv: 'production',
    api: {
      baseUrl: '',
      port: 3000,
      forceProd: false,
    },
  }
};

let mockConstants: any = {
  manifest: null,
  manifest2: null,
  expoConfig: null,
};

mock.module('expo-constants', () => ({
  default: mockConstants,
  __esModule: true,
}));

mock.module('../../config/env', () => mockEnv);

import { getMobileBaseUrl } from '../../config/base-url';

describe('mobile base URL resolution', () => {
  beforeEach(() => {
    (globalThis as any).__DEV__ = false;
    mockEnv.mobileEnv.nodeEnv = 'production';
    mockEnv.mobileEnv.api.baseUrl = '';
    mockEnv.mobileEnv.api.forceProd = false;
  });

  it('returns explicit env URL when it does not look like production', () => {
    (globalThis as any).__DEV__ = true;
    mockEnv.mobileEnv.nodeEnv = 'development';
    mockEnv.mobileEnv.api.baseUrl = 'https://staging.internal:4000';
    
    expect(getMobileBaseUrl()).toBe('https://staging.internal:4000');
  });

  it('sticks to the provided env URL when forceProd is enabled even in dev', () => {
    (globalThis as any).__DEV__ = true;
    mockEnv.mobileEnv.api.baseUrl = 'https://api.taskforceai.chat';
    mockEnv.mobileEnv.api.forceProd = true;
    
    expect(getMobileBaseUrl()).toBe('https://api.taskforceai.chat');
  });

  it('falls back to production URL when not in dev mode', () => {
    (globalThis as any).__DEV__ = false;
    mockEnv.mobileEnv.nodeEnv = 'production';
    mockEnv.mobileEnv.api.baseUrl = '';
    
    expect(getMobileBaseUrl()).toBe('https://api.taskforceai.chat');
  });

  it('prevents redirect issues by defaulting to api. subdomain in production (Hardening TF-0088)', () => {
    (globalThis as any).__DEV__ = false;
    mockEnv.mobileEnv.api.baseUrl = '';

    // We expect api.taskforceai.chat which is the stable endpoint that avoids 307 redirects
    const baseUrl = getMobileBaseUrl();
    expect(baseUrl).toBe('https://api.taskforceai.chat');
    expect(baseUrl).not.toBe('https://www.taskforceai.chat');
    expect(baseUrl).not.toBe('https://taskforceai.chat');
  });

  describe('Host detection (getExpoDevHost)', () => {
    it('detects host from manifest.debuggerHost', () => {
      (globalThis as any).__DEV__ = true;
      mockConstants.manifest = { debuggerHost: '192.168.1.50:19000' };
      
      expect(getMobileBaseUrl()).toBe('http://192.168.1.50:3000');
    });

    it('detects host from manifest2.extra.expoGo.debuggerHost', () => {
      (globalThis as any).__DEV__ = true;
      mockConstants.manifest = null;
      mockConstants.manifest2 = { extra: { expoGo: { debuggerHost: '10.0.0.5:19000' } } };
      
      expect(getMobileBaseUrl()).toBe('http://10.0.0.5:3000');
    });

    it('returns localhost when host is 127.0.0.1', () => {
      (globalThis as any).__DEV__ = true;
      mockConstants.manifest = { hostUri: '127.0.0.1:8081' };
      
      expect(getMobileBaseUrl()).toBe('http://localhost:3000');
    });

    it('supports bracketed IPv6 host URIs', () => {
      (globalThis as any).__DEV__ = true;
      mockConstants.manifest = { hostUri: '[2001:db8::1]:8081' };

      expect(getMobileBaseUrl()).toBe('http://[2001:db8::1]:3000');
    });

    it('returns default when no host is detected', () => {
      (globalThis as any).__DEV__ = true;
      mockConstants.manifest = null;
      mockConstants.manifest2 = null;
      mockConstants.expoConfig = null;
      
      expect(getMobileBaseUrl()).toBe('http://localhost:3000');
    });
  });

});
