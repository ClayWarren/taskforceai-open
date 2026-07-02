import { describe, expect, it } from 'bun:test';

import config from '../../vite.config';

const webConfig = config;

describe('web Vite config', () => {
  it('routes local service proxies to the expected backend ports', () => {
    const proxy = webConfig.server?.proxy as Record<
      string,
      { target: string; changeOrigin?: boolean; cookieDomainRewrite?: string }
    >;

    expect(webConfig.server?.port).toBe(3000);
    expect(webConfig.server?.strictPort).toBe(true);
    expect(webConfig.server?.host).toBe('127.0.0.1');
    expect(proxy['/api/auth']).toMatchObject({
      target: 'http://127.0.0.1:3002',
      changeOrigin: true,
      cookieDomainRewrite: '127.0.0.1',
    });
    expect(proxy['/api/v1/run']?.target).toBe('http://127.0.0.1:3005');
    expect(proxy['/api/v1/stream']?.target).toBe('http://127.0.0.1:3005');
    expect(proxy['/api/v1/sync']?.target).toBe('http://127.0.0.1:3006');
  });

  it('keeps the local Open Graph route out of the generic API proxy', () => {
    const proxy = webConfig.server?.proxy as Record<
      string,
      { bypass?: (req: { url?: string }) => string | undefined }
    >;
    const bypass = proxy['/api']?.bypass;

    expect(bypass?.({ url: '/api/og?title=TaskForceAI' })).toBe('/api/og?title=TaskForceAI');
    expect(bypass?.({ url: '/api/v1/users' })).toBeUndefined();
  });

  it('splits TanStack dependencies into the shared vendor chunk', () => {
    const output = webConfig.build?.rollupOptions?.output;
    const manualChunks =
      !Array.isArray(output) && typeof output?.manualChunks === 'function'
        ? output.manualChunks
        : undefined;
    const manualChunkMeta = { getModuleInfo: () => null };

    expect(
      manualChunks?.('/repo/node_modules/@tanstack/react-router/dist/index.js', manualChunkMeta)
    ).toBe('vendor-tanstack');
    expect(manualChunks?.('/repo/node_modules/react/index.js', manualChunkMeta)).toBeUndefined();
  });
});
