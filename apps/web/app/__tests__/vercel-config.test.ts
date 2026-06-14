import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'bun:test';
import { z } from 'zod';

const vercelRewriteSchema = z.object({
  source: z.string(),
  destination: z.string(),
});

const vercelRedirectSchema = vercelRewriteSchema.extend({
  permanent: z.boolean().optional(),
});

const vercelConfigSchema = z.object({
  buildCommand: z.string(),
  installCommand: z.string(),
  redirects: z.array(vercelRedirectSchema),
  rewrites: z.array(vercelRewriteSchema),
  headers: z.never().optional(),
});

const vercelInstallConfigSchema = z.object({
  buildCommand: z.string(),
  installCommand: z.string(),
});

const loadVercelConfig = () => {
  const configPath = join(import.meta.dir, '../../vercel.json');
  const fileContents = readFileSync(configPath, 'utf8');
  return vercelConfigSchema.parse(JSON.parse(fileContents));
};

const rewriteIndex = (
  rewrites: Array<z.infer<typeof vercelRewriteSchema>>,
  expected: z.infer<typeof vercelRewriteSchema>
) =>
  rewrites.findIndex(
    (rewrite) => rewrite.source === expected.source && rewrite.destination === expected.destination
  );

describe('web vercel rewrites', () => {
  it('uses trusted Bun install commands that enforce the lockfile for frontend deployments', () => {
    const frontendVercelConfigs = [
      'apps/admin/vercel.json',
      'apps/console/vercel.json',
      'apps/marketing/vercel.json',
      'apps/status/vercel.json',
      'apps/web/vercel.json',
    ];

    for (const configFile of frontendVercelConfigs) {
      const configPath = join(import.meta.dir, '../../../../', configFile);
      const config = vercelInstallConfigSchema.parse(JSON.parse(readFileSync(configPath, 'utf8')));

      expect(config.buildCommand).toBe('bun run build:vercel');
      expect(config.installCommand).toBe('cd ../.. && bun install --frozen-lockfile --no-save');
      expect(config.installCommand).not.toContain('curl');
      expect(config.installCommand).not.toContain('bun.sh/install');
    }
  });

  it('routes exact and nested task run requests to engine before the core API fallback', () => {
    const { rewrites } = loadVercelConfig();
    const exactRunRoute = {
      source: '/api/v1/run',
      destination: 'https://engine.taskforceai.chat/api/v1/run',
    };
    const nestedRunRoute = {
      source: '/api/v1/run/(.*)',
      destination: 'https://engine.taskforceai.chat/api/v1/run/$1',
    };
    const cancelTaskRoute = {
      source: '/api/v1/tasks/(.*)/cancel',
      destination: 'https://engine.taskforceai.chat/api/v1/tasks/$1/cancel',
    };
    const coreFallbackRoute = {
      source: '/api/v1/(.*)',
      destination: 'https://api.taskforceai.chat/api/v1/$1',
    };

    expect(rewrites).toContainEqual(exactRunRoute);
    expect(rewrites).toContainEqual(nestedRunRoute);
    expect(rewrites).toContainEqual(cancelTaskRoute);
    expect(rewriteIndex(rewrites, exactRunRoute)).toBeLessThan(
      rewriteIndex(rewrites, coreFallbackRoute)
    );
    expect(rewriteIndex(rewrites, nestedRunRoute)).toBeLessThan(
      rewriteIndex(rewrites, coreFallbackRoute)
    );
    expect(rewriteIndex(rewrites, cancelTaskRoute)).toBeLessThan(
      rewriteIndex(rewrites, coreFallbackRoute)
    );
  });

  it('keeps custom Build Output API run routes aligned with vercel rewrites', () => {
    const buildScriptPath = join(import.meta.dir, '../../scripts/vercel-build.ts');
    const buildScript = readFileSync(buildScriptPath, 'utf8');

    expect(buildScript).toContain(
      "route('/api/v1/run', 'https://engine.taskforceai.chat/api/v1/run')"
    );
    expect(buildScript).toContain(
      "route('/api/v1/run/(.*)', 'https://engine.taskforceai.chat/api/v1/run/$1')"
    );
    expect(buildScript).toContain(
      "route('/api/v1/tasks/(.*)/cancel', 'https://engine.taskforceai.chat/api/v1/tasks/$1/cancel')"
    );
    expect(buildScript.indexOf("route('/api/v1/run'")).toBeLessThan(
      buildScript.indexOf("route('/api/v1/(.*)'")
    );
  });

  it('keeps marketing video assets available through the public web host', () => {
    const { rewrites } = loadVercelConfig();
    const buildScript = readFileSync(
      join(import.meta.dir, '../../scripts/vercel-build.ts'),
      'utf8'
    );

    expect(rewrites).toContainEqual({
      source: '/videos/(.*)',
      destination: 'https://marketing.taskforceai.chat/videos/$1',
    });
    expect(buildScript).toContain(
      "route('/videos/(.*)', 'https://marketing.taskforceai.chat/videos/$1')"
    );
    expect(buildScript.indexOf("route('/videos/(.*)'")).toBeLessThan(
      buildScript.indexOf('serverlessFallbackRoute()')
    );
  });

  it('keeps marketing root icon assets available through the public web host', () => {
    const { rewrites } = loadVercelConfig();
    const buildScript = readFileSync(
      join(import.meta.dir, '../../scripts/vercel-build.ts'),
      'utf8'
    );

    expect(rewrites).toContainEqual({
      source: '/icon-48.webp',
      destination: 'https://marketing.taskforceai.chat/icon-48.webp',
    });
    expect(buildScript).toContain("marketingRoute('/icon-48.webp')");
    expect(buildScript.indexOf("marketingRoute('/icon-48.webp')")).toBeLessThan(
      buildScript.indexOf('filesystemRoute()')
    );
  });

  it('keeps the root path on the product app instead of redirecting to marketing', () => {
    const buildScript = readFileSync(
      join(import.meta.dir, '../../scripts/vercel-build.ts'),
      'utf8'
    );

    expect(buildScript).not.toContain("permanentRedirectRoute('/', '/home')");
    expect(buildScript).not.toContain("route('/', 'https://marketing.taskforceai.chat");
    expect(buildScript.indexOf('filesystemRoute()')).toBeLessThan(
      buildScript.indexOf('serverlessFallbackRoute()')
    );
  });

  it('keeps Build Output API logout and security headers aligned with vercel config', () => {
    const config = loadVercelConfig();
    const buildScript = readFileSync(
      join(import.meta.dir, '../../scripts/vercel-build.ts'),
      'utf8'
    );
    const buildOutputHelper = readFileSync(
      join(import.meta.dir, '../../../../scripts/vercel/build-output.ts'),
      'utf8'
    );

    expect(config.redirects).toContainEqual({
      source: '/auth/logout',
      destination: 'https://auth.taskforceai.chat/api/v1/auth/logout',
      permanent: false,
    });
    expect(buildScript).toContain(
      "temporaryRedirectRoute('/auth/logout', 'https://auth.taskforceai.chat/api/v1/auth/logout')"
    );

    expect(buildOutputHelper).toContain(
      "'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload'"
    );
    expect(buildOutputHelper).toContain("'Content-Security-Policy': contentSecurityPolicy");
    expect(buildOutputHelper).toContain("'X-XSS-Protection': '0'");
    expect(buildScript).toContain(
      'securityHeaderRoute({ contentSecurityPolicy: false, frameOptions: false })'
    );
    expect(buildScript).toContain(
      "responseHeaderRoute('/((?!api/).*)', {\n        'Content-Security-Policy': \"frame-ancestors 'none'\",\n        'X-Frame-Options': 'DENY',\n      })"
    );
    expect(buildScript).not.toContain('securityHeaderRoute(true)');
    expect(config.headers).toBeUndefined();
  });

  it('keeps wildcard CORS scoped to icon assets in Build Output headers', () => {
    const buildOutputHelper = readFileSync(
      join(import.meta.dir, '../../../../scripts/vercel/build-output.ts'),
      'utf8'
    );
    const buildScript = readFileSync(
      join(import.meta.dir, '../../scripts/vercel-build.ts'),
      'utf8'
    );

    expect(buildOutputHelper).toContain(
      '/(favicon-32x32.png|icon.png|icon-48.webp|favicon-16x16.png|apple-touch-icon.png|favicon.ico|manifest.json)'
    );
    expect(buildOutputHelper).toContain("{ key: 'Access-Control-Allow-Origin', value: '*' }");
    expect(buildScript).toContain('headers: [iconResponseHeader()]');
    expect(buildScript).toContain('iconCacheRoute()');
  });
});
