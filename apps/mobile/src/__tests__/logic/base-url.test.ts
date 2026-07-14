import { describe, expect, it, mock, beforeEach } from 'bun:test';

const mockEnv = {
  mobileEnv: {
    nodeEnv: 'production',
    api: {
      baseUrl: '',
      port: 3000,
      forceProd: false,
    },
    sync: {
      baseUrl: undefined as string | undefined,
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

import { getMobileBaseUrl, getMobileRemoteBaseUrl } from '../../config/base-url';

describe('mobile base URL resolution', () => {
  beforeEach(() => {
    (globalThis as any).__DEV__ = false;
    mockEnv.mobileEnv.nodeEnv = 'production';
    mockEnv.mobileEnv.api.baseUrl = '';
    mockEnv.mobileEnv.api.forceProd = false;
    mockEnv.mobileEnv.api.port = 3000;
    mockEnv.mobileEnv.sync.baseUrl = undefined;
    mockConstants.manifest = null;
    mockConstants.manifest2 = null;
    mockConstants.expoConfig = null;
  });

  it('routes Remote requests directly to Sync in production', () => {
    expect(getMobileRemoteBaseUrl()).toBe('https://sync.taskforceai.chat');
  });

  it('supports an explicit Remote Sync service URL', () => {
    mockEnv.mobileEnv.sync.baseUrl = 'https://sync.staging.example';

    expect(getMobileRemoteBaseUrl()).toBe('https://sync.staging.example');
  });

  it('routes Remote requests through the local API host in development', () => {
    (globalThis as any).__DEV__ = true;
    mockEnv.mobileEnv.api.baseUrl = 'https://staging.internal:4000';

    expect(getMobileRemoteBaseUrl()).toBe('https://staging.internal:4000');
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

  it('uses explicit production env URL outside dev mode', () => {
    (globalThis as any).__DEV__ = false;
    mockEnv.mobileEnv.nodeEnv = 'production';
    mockEnv.mobileEnv.api.baseUrl = 'https://custom.taskforceai.chat';

    expect(getMobileBaseUrl()).toBe('https://custom.taskforceai.chat');
  });

  it('ignores production-like env URL in dev mode unless forceProd is enabled', () => {
    (globalThis as any).__DEV__ = true;
    mockEnv.mobileEnv.nodeEnv = 'development';
    mockEnv.mobileEnv.api.baseUrl = 'https://api.taskforceai.chat';
    mockConstants.manifest = { debuggerHost: '192.168.1.50:19000' };

    expect(getMobileBaseUrl()).toBe('http://192.168.1.50:3000');
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
    it('prefers expoConfig.hostUri before manifest values', () => {
      (globalThis as any).__DEV__ = true;
      mockConstants.expoConfig = { hostUri: '172.16.0.20:8081' };
      mockConstants.manifest = { debuggerHost: '192.168.1.50:19000' };
      mockEnv.mobileEnv.api.port = 4000;

      expect(getMobileBaseUrl()).toBe('http://172.16.0.20:4000');
    });

    it('detects host from manifest.debuggerHost', () => {
      (globalThis as any).__DEV__ = true;
      mockConstants.manifest = { debuggerHost: '192.168.1.50:19000' };
      
      expect(getMobileBaseUrl()).toBe('http://192.168.1.50:3000');
    });

    it('detects host from manifest.hostUri when debuggerHost is missing', () => {
      (globalThis as any).__DEV__ = true;
      mockConstants.manifest = { hostUri: '192.168.1.51:8081' };

      expect(getMobileBaseUrl()).toBe('http://192.168.1.51:3000');
    });

    it('detects host from manifest2.extra.expoGo.debuggerHost', () => {
      (globalThis as any).__DEV__ = true;
      mockConstants.manifest = null;
      mockConstants.manifest2 = { extra: { expoGo: { debuggerHost: '10.0.0.5:19000' } } };
      
      expect(getMobileBaseUrl()).toBe('http://10.0.0.5:3000');
    });

    it('detects host from manifest2.extra.expoGo.hostUri', () => {
      (globalThis as any).__DEV__ = true;
      mockConstants.manifest2 = { extra: { expoGo: { hostUri: '10.0.0.6:8081' } } };

      expect(getMobileBaseUrl()).toBe('http://10.0.0.6:3000');
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
      
      expect(getMobileBaseUrl()).toBe('http://localhost:3000');
    });

    it('ignores Expo tunnel hosts and falls back to localhost', () => {
      (globalThis as any).__DEV__ = true;
      mockConstants.manifest = { hostUri: 'project.exp.direct:8081' };

      expect(getMobileBaseUrl()).toBe('http://localhost:3000');

      mockConstants.manifest = { hostUri: 'project.expo.dev:8081' };
      expect(getMobileBaseUrl()).toBe('http://localhost:3000');
    });

    it('falls back to localhost for invalid host candidates', () => {
      (globalThis as any).__DEV__ = true;
      mockConstants.manifest = { hostUri: '/only/path' };

      expect(getMobileBaseUrl()).toBe('http://localhost:3000');
    });
  });

});
