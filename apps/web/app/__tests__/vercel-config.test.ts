import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'bun:test';
import { z } from 'zod';

import {
  authLogoutRedirect,
  buildOutputWebApiRoutes,
  marketingRoute,
  serviceRoute,
} from '../../../../scripts/vercel/routes';

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

const frontendInstallCommand =
  'script=../../scripts/vercel/install-frontend-deps.ts; [ -f "$script" ] || script=scripts/vercel/install-frontend-deps.ts; bun "$script"';

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
  it('uses pinned Bun install commands for frontend deployments', () => {
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
      expect(config.installCommand).toBe(frontendInstallCommand);
      expect(config.installCommand).toContain('install-frontend-deps.ts');
      expect(config.installCommand).not.toContain('curl');
      expect(config.installCommand).not.toContain('bash');
      expect(config.installCommand).not.toContain('install --no-save');
      expect(config.buildCommand).not.toContain('npm');
      expect(config.installCommand).not.toContain('npm');
      expect(config.buildCommand).not.toContain('pnpm');
      expect(config.installCommand).not.toContain('pnpm');
    }

    const installScript = readFileSync(
      join(process.cwd(), 'scripts/vercel/install-frontend-deps.ts'),
      'utf8'
    );
    expect(installScript).toContain('packageManager');
    expect(installScript).toContain('--frozen-lockfile');
    expect(installScript).toContain('NODE_ENV');

    const vercelIgnore = readFileSync(join(process.cwd(), '.vercelignore'), 'utf8');
    expect(vercelIgnore).toContain('apps/mobile/*');
    expect(vercelIgnore).toContain('!apps/mobile/package.json');
    expect(vercelIgnore).not.toContain('\napps/mobile\n');
    expect(vercelIgnore).toContain('apps/tui/*');
    expect(vercelIgnore).toContain('!apps/tui/install.sh');
    expect(vercelIgnore).toContain('!apps/tui/install.ps1');
    expect(vercelIgnore).not.toContain('\napps/tui\n');
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
    const reserveVoiceRoute = {
      source: '/api/v1/voice/reserve',
      destination: 'https://engine.taskforceai.chat/api/v1/voice/reserve',
    };
    const coreFallbackRoute = {
      source: '/api/v1/(.*)',
      destination: 'https://api.taskforceai.chat/api/v1/$1',
    };

    expect(rewrites).toContainEqual(exactRunRoute);
    expect(rewrites).toContainEqual(nestedRunRoute);
    expect(rewrites).toContainEqual(cancelTaskRoute);
    expect(rewrites).toContainEqual(reserveVoiceRoute);
    expect(rewriteIndex(rewrites, exactRunRoute)).toBeLessThan(
      rewriteIndex(rewrites, coreFallbackRoute)
    );
    expect(rewriteIndex(rewrites, nestedRunRoute)).toBeLessThan(
      rewriteIndex(rewrites, coreFallbackRoute)
    );
    expect(rewriteIndex(rewrites, cancelTaskRoute)).toBeLessThan(
      rewriteIndex(rewrites, coreFallbackRoute)
    );
    expect(rewriteIndex(rewrites, reserveVoiceRoute)).toBeLessThan(
      rewriteIndex(rewrites, coreFallbackRoute)
    );
  });

  it('routes Remote requests to sync before the core API fallback', () => {
    const { rewrites } = loadVercelConfig();
    const remoteRewrite = {
      source: '/api/v1/remote/(.*)',
      destination: 'https://sync.taskforceai.chat/api/v1/remote/$1',
    };
    const coreRewrite = {
      source: '/api/v1/(.*)',
      destination: 'https://api.taskforceai.chat/api/v1/$1',
    };
    const remoteBuildOutputRoute = {
      src: '/api/v1/remote/(.*)',
      dest: 'https://sync.taskforceai.chat/api/v1/remote/$1',
    };
    const coreBuildOutputRoute = {
      src: '/api/v1/(.*)',
      dest: 'https://api.taskforceai.chat/api/v1/$1',
    };
    const buildOutputRoutes = buildOutputWebApiRoutes();

    expect(rewrites).toContainEqual(remoteRewrite);
    expect(rewriteIndex(rewrites, remoteRewrite)).toBeLessThan(rewriteIndex(rewrites, coreRewrite));
    expect(buildOutputRoutes).toContainEqual(remoteBuildOutputRoute);
    expect(
      buildOutputRoutes.findIndex((route) => route['src'] === remoteBuildOutputRoute.src)
    ).toBeLessThan(
      buildOutputRoutes.findIndex((route) => route['src'] === coreBuildOutputRoute.src)
    );
  });

  it('keeps custom Build Output API run routes aligned with vercel rewrites', () => {
    const buildScriptPath = join(import.meta.dir, '../../scripts/vercel-build.ts');
    const buildScript = readFileSync(buildScriptPath, 'utf8');

    const buildOutputRoutes = buildOutputWebApiRoutes();
    expect(buildOutputRoutes).toContainEqual({
      src: '/api/v1/run',
      dest: 'https://engine.taskforceai.chat/api/v1/run',
    });
    expect(buildOutputRoutes).toContainEqual({
      src: '/api/v1/run/(.*)',
      dest: 'https://engine.taskforceai.chat/api/v1/run/$1',
    });
    expect(buildOutputRoutes).toContainEqual({
      src: '/api/v1/tasks/(.*)/cancel',
      dest: 'https://engine.taskforceai.chat/api/v1/tasks/$1/cancel',
    });
    expect(buildOutputRoutes).toContainEqual({
      src: '/api/v1/voice/reserve',
      dest: 'https://engine.taskforceai.chat/api/v1/voice/reserve',
    });
    expect(buildOutputRoutes.findIndex((route) => route['src'] === '/api/v1/run')).toBeLessThan(
      buildOutputRoutes.findIndex((route) => route['src'] === '/api/v1/(.*)')
    );
    expect(buildScript).toContain('buildOutputWebApiRoutes()');
  });

  it('keeps web-owned voice API routes ahead of the core API fallback in Build Output', () => {
    const buildOutputRoutes = buildOutputWebApiRoutes();
    const realtimeRoute = { src: '/api/realtime/(.*)', dest: '/index' };
    const dictationRoute = { src: '/api/dictation/(.*)', dest: '/index' };
    const speechRoute = { src: '/api/speech/(.*)', dest: '/index' };
    const coreFallbackRoute = {
      src: '/api/(.*)',
      dest: 'https://api.taskforceai.chat/api/$1',
    };

    expect(buildOutputRoutes).toContainEqual(realtimeRoute);
    expect(buildOutputRoutes).toContainEqual(dictationRoute);
    expect(buildOutputRoutes).toContainEqual(speechRoute);
    expect(buildOutputRoutes.findIndex((route) => route['src'] === realtimeRoute.src)).toBeLessThan(
      buildOutputRoutes.findIndex((route) => route['src'] === coreFallbackRoute.src)
    );
    expect(
      buildOutputRoutes.findIndex((route) => route['src'] === dictationRoute.src)
    ).toBeLessThan(buildOutputRoutes.findIndex((route) => route['src'] === coreFallbackRoute.src));
    expect(buildOutputRoutes.findIndex((route) => route['src'] === speechRoute.src)).toBeLessThan(
      buildOutputRoutes.findIndex((route) => route['src'] === coreFallbackRoute.src)
    );
  });

  it('keeps the local Open Graph image route ahead of the core API fallback', () => {
    const buildScript = readFileSync(
      join(import.meta.dir, '../../scripts/vercel-build.ts'),
      'utf8'
    );
    const buildOutputRoutes = buildOutputWebApiRoutes();

    expect(buildOutputRoutes).toContainEqual({
      src: '/api/(.*)',
      dest: 'https://api.taskforceai.chat/api/$1',
    });
    expect(buildScript.indexOf("route('/api/og', '/index')")).toBeGreaterThanOrEqual(0);
    expect(buildScript.indexOf("route('/api/og', '/index')")).toBeLessThan(
      buildScript.indexOf('buildOutputWebApiRoutes()')
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
    expect(serviceRoute('/videos/(.*)', 'marketing', '/videos/$1')).toEqual({
      src: '/videos/(.*)',
      dest: 'https://marketing.taskforceai.chat/videos/$1',
    });
    expect(buildScript).toContain("serviceRoute('/videos/(.*)', 'marketing', '/videos/$1')");
    expect(buildScript.indexOf("serviceRoute('/videos/(.*)'")).toBeLessThan(
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
    expect(marketingRoute('/icon-48.webp')).toEqual({
      src: '/icon-48.webp',
      dest: 'https://marketing.taskforceai.chat/icon-48.webp',
    });
    expect(buildScript).toContain("marketingRoute('/icon-48.webp')");
    expect(buildScript.indexOf("marketingRoute('/icon-48.webp')")).toBeLessThan(
      buildScript.indexOf('filesystemRoute()')
    );
  });

  it('keeps the App Store support URL available through the public web host', () => {
    const { rewrites } = loadVercelConfig();
    const buildScript = readFileSync(
      join(import.meta.dir, '../../scripts/vercel-build.ts'),
      'utf8'
    );

    expect(rewrites).toContainEqual({
      source: '/support',
      destination: 'https://marketing.taskforceai.chat/support',
    });
    expect(marketingRoute('/support')).toEqual({
      src: '/support',
      dest: 'https://marketing.taskforceai.chat/support',
    });
    expect(buildScript).toContain("['/support']");
    expect(buildScript.indexOf("['/support']")).toBeLessThan(
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

  it('keeps Build Output API logout and browser security headers aligned with vercel config', () => {
    const config = loadVercelConfig();
    const buildScript = readFileSync(
      join(import.meta.dir, '../../scripts/vercel-build.ts'),
      'utf8'
    );
    const buildOutputHelper = readFileSync(
      join(import.meta.dir, '../../../../scripts/vercel/build-output.ts'),
      'utf8'
    );
    const sharedHeaders = readFileSync(
      join(
        import.meta.dir,
        '../../../../packages/infrastructure/ts/config/src/frontend-security-headers.ts'
      ),
      'utf8'
    );

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

    expect(buildOutputHelper).toContain(
      "'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload'"
    );
    expect(buildOutputHelper).toContain("'Content-Security-Policy': contentSecurityPolicy");
    expect(buildOutputHelper).toContain("'X-XSS-Protection': '0'");
    expect(buildOutputHelper).toContain("'Referrer-Policy': 'strict-origin-when-cross-origin'");
    expect(buildOutputHelper).toContain("'Permissions-Policy'");
    expect(buildScript).toContain("buildFrontendContentSecurityPolicy('web'");
    expect(buildScript).toContain(
      'securityHeaderRoute({ contentSecurityPolicy: false, frameOptions: false })'
    );
    expect(buildScript).toContain("responseHeaderRoute('/((?!api/).*)'");
    expect(buildScript).toContain("'Content-Security-Policy': webContentSecurityPolicy");
    expect(sharedHeaders).toContain("'Permissions-Policy'");
    expect(sharedHeaders).toContain("frame-ancestors 'none'");
    expect(sharedHeaders).toContain('https://js.stripe.com');
    expect(sharedHeaders).toContain('https://*.taskforceai.chat');
    expect(buildScript).not.toContain('securityHeaderRoute(true)');
    expect(buildScript.indexOf('securityHeaderRoute({ contentSecurityPolicy: false')).toBeLessThan(
      buildScript.indexOf("responseHeaderRoute('/((?!api/).*)'")
    );
    expect(buildScript.indexOf("responseHeaderRoute('/((?!api/).*)'")).toBeLessThan(
      buildScript.indexOf('buildOutputWebApiRoutes()')
    );
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
