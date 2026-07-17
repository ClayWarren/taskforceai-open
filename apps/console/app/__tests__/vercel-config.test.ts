import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'bun:test';

import { authLogoutRedirect, buildOutputConsoleApiRoutes } from '../../../../scripts/vercel/routes';

type VercelConfig = {
  redirects?: Array<{
    source: string;
    destination: string;
    permanent?: boolean;
  }>;
  rewrites?: Array<{
    source: string;
    destination: string;
  }>;
};

type PackageManifest = {
  dependencies?: Record<string, string>;
  scripts?: Record<string, string>;
};

const consoleRoot = join(import.meta.dir, '../..');

const loadVercelConfig = (): VercelConfig => {
  const configPath = join(consoleRoot, 'vercel.json');
  return JSON.parse(readFileSync(configPath, 'utf8')) as VercelConfig;
};

const loadBuildScript = (): string => {
  const buildScriptPath = join(consoleRoot, 'scripts/vercel-build.ts');
  return readFileSync(buildScriptPath, 'utf8');
};

const loadPublicIndex = (): string => readFileSync(join(consoleRoot, 'public/index.html'), 'utf8');

const loadPackageManifest = (): PackageManifest =>
  JSON.parse(readFileSync(join(consoleRoot, 'package.json'), 'utf8')) as PackageManifest;

const expectBuildRoute = (buildScript: string, routeSnippet: string): number => {
  const index = buildScript.indexOf(routeSnippet);
  expect(index).toBeGreaterThanOrEqual(0);
  return index;
};

describe('console vercel routing', () => {
  it('keeps the directly served index fallback console-branded', () => {
    const publicIndex = loadPublicIndex();

    expect(publicIndex).toContain('<title>TaskForceAI Console</title>');
    expect(publicIndex).toContain('Opening TaskForceAI Console');
    expect(publicIndex).not.toContain('TaskForceAI Desktop');
  });

  it('keeps hosted logout redirected to the auth service', () => {
    const config = loadVercelConfig();
    const buildScript = loadBuildScript();

    expect(config.redirects).toContainEqual({
      source: '/auth/logout',
      destination: 'https://auth.taskforceai.chat/api/v1/auth/logout',
      permanent: false,
    });
    expect(authLogoutRedirect()).toEqual({
      src: '/auth/logout',
      status: 307,
      headers: { Location: 'https://auth.taskforceai.chat/api/v1/auth/logout' },
    });
    expect(buildScript).toContain('authLogoutRedirect()');
  });

  it('routes console API traffic to the owning production services before generic fallbacks', () => {
    const config = loadVercelConfig();
    const buildScript = loadBuildScript();

    expect(config.rewrites).toContainEqual({
      source: '/api/auth/:path*',
      destination: 'https://auth.taskforceai.chat/api/auth/:path*',
    });
    expect(config.rewrites).toContainEqual({
      source: '/api/v1/auth/:path*',
      destination: 'https://auth.taskforceai.chat/api/v1/auth/:path*',
    });
    expect(config.rewrites).toContainEqual({
      source: '/api/v1/billing/:path*',
      destination: 'https://billing.taskforceai.chat/api/v1/billing/:path*',
    });
    expect(config.rewrites).toContainEqual({
      source: '/api/v1/:path*',
      destination: 'https://api.taskforceai.chat/api/v1/:path*',
    });

    const routes = buildOutputConsoleApiRoutes();
    const genericV1Route = routes.findIndex((route) => route['src'] === '/api/v1/(.*)');
    const genericApiRoute = routes.findIndex((route) => route['src'] === '/api/(.*)');

    for (const routeSource of [
      '/api/auth/(.*)',
      '/api/v1/auth/(.*)',
      '/api/v1/developer/(.*)',
      '/api/v1/billing/(.*)',
      '/api/v1/payments/(.*)',
      '/api/v1/checkout/(.*)',
    ]) {
      const routeIndex = routes.findIndex((route) => route['src'] === routeSource);
      expect(routeIndex).toBeGreaterThanOrEqual(0);
      expect(routeIndex).toBeLessThan(genericV1Route);
      expect(routeIndex).toBeLessThan(genericApiRoute);
    }
    expectBuildRoute(buildScript, 'buildOutputConsoleApiRoutes()');
  });

  it('declares direct UI imports and exposes only runnable package scripts', () => {
    const manifest = loadPackageManifest();

    expect(manifest.dependencies?.['@taskforceai/ui-kit']).toBe('workspace:*');
    expect(manifest.scripts).not.toHaveProperty('build:desktop');
    expect(manifest.scripts).not.toHaveProperty('start');
  });
});
