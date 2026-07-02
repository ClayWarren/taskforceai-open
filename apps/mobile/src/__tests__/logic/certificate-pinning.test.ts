import { describe, it, expect, mock } from 'bun:test';

// Set __DEV__ for test context
declare const __DEV__: boolean;

// We need to test both dev and prod modes. The module reads __DEV__ at call
// time so we can control behavior by setting the global before each test.

const REALISTIC_TEST_PINS = [
  'k4v39QrcwyiVEaVQPY6Vd98D4P5o6HmefN0mQhV6spQ=',
  'f4M8mMx2N8cQ6i5h6uQk7B2Wm5f8K8Yg6T5nYwQ2P9I=',
] as const;

const PLACEHOLDER_PINS = [
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=',
] as const;

const setPinHashes = async (pins: readonly string[]): Promise<void> => {
  const module = await import('../../security/certificate-pinning');
  const mutablePins = module.PINNED_SPKI_HASHES as unknown as string[];
  mutablePins.splice(0, mutablePins.length, ...pins);
};

describe('certificate-pinning', () => {
  describe('isPinnedDomain', () => {
    it('returns true for api.taskforceai.chat', async () => {
      const { isPinnedDomain } = await import('../../security/certificate-pinning');
      expect(isPinnedDomain('https://api.taskforceai.chat/api/v1/run')).toBe(true);
    });

    it('returns true for www.taskforceai.chat', async () => {
      const { isPinnedDomain } = await import('../../security/certificate-pinning');
      expect(isPinnedDomain('https://www.taskforceai.chat/api/v1/auth/me')).toBe(true);
    });

    it('returns false for localhost', async () => {
      const { isPinnedDomain } = await import('../../security/certificate-pinning');
      expect(isPinnedDomain('http://localhost:3000/api/v1/run')).toBe(false);
    });

    it('returns false for arbitrary domains', async () => {
      const { isPinnedDomain } = await import('../../security/certificate-pinning');
      expect(isPinnedDomain('https://evil.example.com/api/v1/run')).toBe(false);
    });

    it('returns false for invalid URLs', async () => {
      const { isPinnedDomain } = await import('../../security/certificate-pinning');
      expect(isPinnedDomain('not-a-url')).toBe(false);
    });
  });

  describe('assertProductionDomain', () => {
    it('does not throw in __DEV__ mode for any domain', async () => {
      (globalThis as any).__DEV__ = true;
      const { assertProductionDomain } = await import('../../security/certificate-pinning');
      expect(() => assertProductionDomain('http://localhost:3000/api/v1/run')).not.toThrow();
      expect(() => assertProductionDomain('https://evil.example.com/foo')).not.toThrow();
    });

    it('does not throw in prod mode for pinned domains', async () => {
      (globalThis as any).__DEV__ = false;
      // Re-import to pick up new __DEV__ value at call time
      const { assertProductionDomain } = await import('../../security/certificate-pinning');
      expect(() => assertProductionDomain('https://api.taskforceai.chat/api/v1/run')).not.toThrow();
      expect(() => assertProductionDomain('https://www.taskforceai.chat/api/v1/run')).not.toThrow();
    });

    it('throws in prod mode for non-pinned domains', async () => {
      (globalThis as any).__DEV__ = false;
      const { assertProductionDomain } = await import('../../security/certificate-pinning');
      expect(() => assertProductionDomain('https://evil.example.com/api/v1/run')).toThrow(
        /non-pinned domain/i
      );
    });
  });

  describe('createPinnedFetch', () => {
    it('calls through to the base fetch for pinned domains', async () => {
      (globalThis as any).__DEV__ = false;
      await setPinHashes(REALISTIC_TEST_PINS);
      const { createPinnedFetch } = await import('../../security/certificate-pinning');

      const mockResponse = new Response('ok', { status: 200 });
      const baseFetch = mock(() => Promise.resolve(mockResponse));

      const pinnedFetch = createPinnedFetch(baseFetch as any);
      const result = await pinnedFetch('https://api.taskforceai.chat/api/v1/run');

      expect(baseFetch).toHaveBeenCalledTimes(1);
      expect(result).toBe(mockResponse);
    });

    it('accepts URL and Request inputs for pinned domains', async () => {
      (globalThis as any).__DEV__ = false;
      await setPinHashes(REALISTIC_TEST_PINS);
      const { createPinnedFetch } = await import('../../security/certificate-pinning');

      const baseFetch = mock(() => Promise.resolve(new Response('ok')));
      const pinnedFetch = createPinnedFetch(baseFetch as any);
      const url = new URL('https://api.taskforceai.chat/api/v1/run');
      const request = new Request('https://www.taskforceai.chat/api/v1/auth/me');

      await expect(pinnedFetch(url)).resolves.toBeInstanceOf(Response);
      await expect(pinnedFetch(request)).resolves.toBeInstanceOf(Response);
      expect(baseFetch).toHaveBeenCalledTimes(2);
      expect(baseFetch).toHaveBeenNthCalledWith(1, url, undefined);
      expect(baseFetch).toHaveBeenNthCalledWith(2, request, undefined);
    });

    it('rejects non-pinned domains in production', async () => {
      (globalThis as any).__DEV__ = false;
      await setPinHashes(REALISTIC_TEST_PINS);
      const { createPinnedFetch } = await import('../../security/certificate-pinning');

      const baseFetch = mock(() => Promise.resolve(new Response('ok')));
      const pinnedFetch = createPinnedFetch(baseFetch as any);

      await expect(pinnedFetch('https://evil.example.com/steal-data')).rejects.toThrow(
        /non-pinned domain/i
      );
      expect(baseFetch).not.toHaveBeenCalled();
    });

    it('rethrows production TLS verification failures from the base fetch', async () => {
      (globalThis as any).__DEV__ = false;
      await setPinHashes(REALISTIC_TEST_PINS);
      const { createPinnedFetch } = await import('../../security/certificate-pinning');

      const baseFetch = mock(() => Promise.reject(new TypeError('certificate verify failed')));
      const pinnedFetch = createPinnedFetch(baseFetch as any);

      await expect(pinnedFetch('https://api.taskforceai.chat/api/v1/run')).rejects.toThrow(
        'certificate verify failed'
      );
      expect(baseFetch).toHaveBeenCalledTimes(1);
    });

    it('allows any domain in dev mode', async () => {
      (globalThis as any).__DEV__ = true;
      await setPinHashes(PLACEHOLDER_PINS);
      const { createPinnedFetch } = await import('../../security/certificate-pinning');

      const mockResponse = new Response('ok');
      const baseFetch = mock(() => Promise.resolve(mockResponse));
      const pinnedFetch = createPinnedFetch(baseFetch as any);

      const result = await pinnedFetch('http://localhost:3000/api/v1/run');
      expect(baseFetch).toHaveBeenCalledTimes(1);
      expect(result).toBe(mockResponse);
    });

    it('fails fast in production when placeholder pins remain configured', async () => {
      (globalThis as any).__DEV__ = false;
      await setPinHashes(PLACEHOLDER_PINS);
      const { createPinnedFetch } = await import('../../security/certificate-pinning');

      const baseFetch = mock(() => Promise.resolve(new Response('ok')));
      const pinnedFetch = createPinnedFetch(baseFetch as any);

      await expect(pinnedFetch('https://api.taskforceai.chat/api/v1/run')).rejects.toThrow(
        /placeholder spki hashes/i
      );
      expect(baseFetch).not.toHaveBeenCalled();
    });
  });

  describe('PINNED_SPKI_HASHES', () => {
    it('contains at least two pins (primary + backup)', async () => {
      const { PINNED_SPKI_HASHES } = await import('../../security/certificate-pinning');
      expect(PINNED_SPKI_HASHES.length).toBeGreaterThanOrEqual(2);
    });

    it('keeps leaf and CA pins classified separately', async () => {
      const { PINNED_LEAF_SPKI_HASHES, PINNED_CA_SPKI_HASHES, PINNED_SPKI_HASHES } =
        await import('../../security/certificate-pinning');
      await setPinHashes([...PINNED_LEAF_SPKI_HASHES, ...PINNED_CA_SPKI_HASHES]);

      expect(PINNED_LEAF_SPKI_HASHES).toHaveLength(2);
      expect(PINNED_CA_SPKI_HASHES).toHaveLength(1);
      expect(PINNED_SPKI_HASHES).toEqual([
        ...PINNED_LEAF_SPKI_HASHES,
        ...PINNED_CA_SPKI_HASHES,
      ]);
    });

    it('all hashes are base64 encoded strings', async () => {
      const { PINNED_SPKI_HASHES } = await import('../../security/certificate-pinning');
      for (const hash of PINNED_SPKI_HASHES) {
        expect(typeof hash).toBe('string');
        expect(hash.endsWith('=')).toBe(true);
        expect(hash.length).toBeGreaterThan(10);
      }
    });
  });

  describe('production pin validation', () => {
    it('identifies placeholder pins', async () => {
      const { isPlaceholderPinHash } = await import('../../security/certificate-pinning');
      expect(isPlaceholderPinHash('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=')).toBe(true);
      expect(isPlaceholderPinHash('k4v39QrcwyiVEaVQPY6Vd98D4P5o6HmefN0mQhV6spQ=')).toBe(false);
    });

    it('skips placeholder pin validation in development mode', async () => {
      (globalThis as any).__DEV__ = true;
      await setPinHashes(PLACEHOLDER_PINS);
      const { assertProductionPinConfiguration } = await import(
        '../../security/certificate-pinning'
      );

      expect(() => assertProductionPinConfiguration()).not.toThrow();
    });
  });

  describe('Expo plugin guard', () => {
    it('allows production builds when real pins are configured', async () => {
      const previousNodeEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'production';
        const plugin = require('../../../plugins/withCertificatePinning.js');
        expect(() => plugin.__internal.assertNoPlaceholderPinsForProduction()).not.toThrow();
      } finally {
        process.env.NODE_ENV = previousNodeEnv;
      }
    });

    it('does not block non-production builds', async () => {
      const previousNodeEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'development';
        const plugin = require('../../../plugins/withCertificatePinning.js');
        expect(() => plugin.__internal.assertNoPlaceholderPinsForProduction()).not.toThrow();
      } finally {
        process.env.NODE_ENV = previousNodeEnv;
      }
    });

    it('exports separate iOS leaf and CA pin groups', async () => {
      const plugin = require('../../../plugins/withCertificatePinning.js');
      expect(plugin.__internal.LEAF_SPKI_HASHES).toHaveLength(2);
      expect(plugin.__internal.CA_SPKI_HASHES).toHaveLength(1);
      expect(plugin.__internal.IOS_PINNED_HASHES).toEqual(plugin.__internal.CA_SPKI_HASHES);
    });

    it('generates Android domain-config entries with domain children', async () => {
      const plugin = require('../../../plugins/withCertificatePinning.js');
      const xml = plugin.__internal.buildNetworkSecurityConfig();
      const productionDomainConfig = xml.match(
        /<domain-config cleartextTrafficPermitted="false">([\s\S]*?)<\/domain-config>/
      );

      expect(productionDomainConfig).not.toBeNull();
      expect(productionDomainConfig?.[1]).toContain(
        '<domain includeSubdomains="true">api.taskforceai.chat</domain>'
      );
      expect(productionDomainConfig?.[1]).toContain(
        '<domain includeSubdomains="true">www.taskforceai.chat</domain>'
      );
      expect(productionDomainConfig?.[1]).toContain('<pin-set expiration="2027-01-01">');
      expect(productionDomainConfig?.[1]).not.toContain('<domain-config>');
    });

    it('generates a debug Android config that permits local cleartext traffic', async () => {
      const plugin = require('../../../plugins/withCertificatePinning.js');
      const xml = plugin.__internal.buildDebugNetworkSecurityConfig();

      expect(xml).toContain('<base-config cleartextTrafficPermitted="true">');
      expect(xml).toContain('<certificates src="user" />');
      expect(xml).not.toContain('<pin-set');
      expect(xml).not.toContain('<domain-config');
    });
  });
});
