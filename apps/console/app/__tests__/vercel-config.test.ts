import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'bun:test';

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

const consoleRoot = join(import.meta.dir, '../..');

const loadVercelConfig = (): VercelConfig => {
  const configPath = join(consoleRoot, 'vercel.json');
  return JSON.parse(readFileSync(configPath, 'utf8')) as VercelConfig;
};

const loadBuildScript = (): string => {
  const buildScriptPath = join(consoleRoot, 'scripts/vercel-build.ts');
  return readFileSync(buildScriptPath, 'utf8');
};

const expectBuildRoute = (buildScript: string, routeSnippet: string): number => {
  const index = buildScript.indexOf(routeSnippet);
  expect(index).toBeGreaterThanOrEqual(0);
  return index;
};

describe('console vercel routing', () => {
  it('keeps hosted logout redirected to the auth service', () => {
    const config = loadVercelConfig();
    const buildScript = loadBuildScript();

    expect(config.redirects).toContainEqual({
      source: '/auth/logout',
      destination: 'https://auth.taskforceai.chat/api/v1/auth/logout',
      permanent: false,
    });
    expect(buildScript).toContain(
      "temporaryRedirectRoute('/auth/logout', 'https://auth.taskforceai.chat/api/v1/auth/logout')"
    );
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
      source: '/api/v1/:path*',
      destination: 'https://api.taskforceai.chat/api/v1/:path*',
    });

    const genericV1Route = expectBuildRoute(
      buildScript,
      "route('/api/v1/(.*)', 'https://api.taskforceai.chat/api/v1/$1')"
    );
    const genericApiRoute = expectBuildRoute(
      buildScript,
      "route('/api/(.*)', 'https://api.taskforceai.chat/api/$1')"
    );

    for (const routeSnippet of [
      "route('/api/auth/(.*)', 'https://auth.taskforceai.chat/api/auth/$1')",
      "route('/api/v1/auth/(.*)', 'https://auth.taskforceai.chat/api/v1/auth/$1')",
      "route('/api/v1/developer/(.*)', 'https://developer.taskforceai.chat/api/v1/developer/$1')",
      "route('/api/v1/payments/(.*)', 'https://billing.taskforceai.chat/api/v1/payments/$1')",
      "route('/api/v1/checkout/(.*)', 'https://billing.taskforceai.chat/api/v1/checkout/$1')",
    ]) {
      expectBuildRoute(buildScript, routeSnippet);
      expect(buildScript.indexOf(routeSnippet)).toBeLessThan(genericV1Route);
      expect(buildScript.indexOf(routeSnippet)).toBeLessThan(genericApiRoute);
    }
  });
});
