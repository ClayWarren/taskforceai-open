#!/usr/bin/env bun
import {
  buildStaticSpaOutput,
  filesystemRoute,
  handleBuildFailure,
  route,
} from '../../../scripts/vercel/build-output';

const REQUIRED_STATUS_JSON_ENV = 'VITE_STATUS_JSON_URL';
const API_STATUS_URL = 'https://api.taskforceai.chat/api/v1/status';
const STATUS_JSON_CSP_HOST_SUFFIX = '.public.blob.vercel-storage.com';

export function isVercelBuild(): boolean {
  return process.env['VERCEL'] === '1' || Boolean(process.env['VERCEL_ENV']);
}

export function resolveStatusJsonRouteDestination(): string {
  return process.env[REQUIRED_STATUS_JSON_ENV]?.trim() || API_STATUS_URL;
}

export function assertStatusJsonUrl(): void {
  const candidate = process.env[REQUIRED_STATUS_JSON_ENV]?.trim();
  if (!isVercelBuild()) {
    return;
  }

  if (!candidate) {
    throw new Error(
      `${REQUIRED_STATUS_JSON_ENV} is required for Vercel status builds. Seed status.json to Blob, set the printed Blob URL in Vercel, then redeploy.`
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(`${REQUIRED_STATUS_JSON_ENV} must be an absolute HTTPS URL.`);
  }

  if (parsed.protocol !== 'https:') {
    throw new Error(`${REQUIRED_STATUS_JSON_ENV} must use HTTPS.`);
  }

  const apiStatus = new URL(API_STATUS_URL);
  const isLiveApiStatus =
    parsed.origin === apiStatus.origin && parsed.pathname.replace(/\/$/, '') === apiStatus.pathname;

  if (isLiveApiStatus) {
    throw new Error(
      `${REQUIRED_STATUS_JSON_ENV} must point at the Blob-backed status.json, not the live API fallback.`
    );
  }

  if (!parsed.hostname.endsWith(STATUS_JSON_CSP_HOST_SUFFIX)) {
    throw new Error(
      `${REQUIRED_STATUS_JSON_ENV} must use a Blob host allowed by the status CSP connect-src (*.public.blob.vercel-storage.com).`
    );
  }
}

async function main(): Promise<void> {
  assertStatusJsonUrl();
  const statusJsonRouteDestination = resolveStatusJsonRouteDestination();

  await buildStaticSpaOutput({
    appName: 'TanStack Start Status',
    outputConfig: {
      version: 3,
      routes: [
        {
          src: '/(.*)',
          headers: {
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'DENY',
            'X-XSS-Protection': '0',
            'Referrer-Policy': 'strict-origin-when-cross-origin',
            'Content-Security-Policy':
              "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https://api.taskforceai.chat https://*.sentry.io https://*.public.blob.vercel-storage.com; frame-ancestors 'none'",
            'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
          },
          continue: true,
        },
        {
          src: '/assets/(.*)',
          headers: { 'Cache-Control': 'public, max-age=31536000, immutable' },
          continue: true,
        },
        filesystemRoute(),
        route('/status.json', statusJsonRouteDestination),
        route('/api/v1/(.*)', 'https://api.taskforceai.chat/api/v1/$1'),
        {
          src: '/((?!api/|assets/|.*\\.(?:json|png|jpg|ico|svg|txt)$).*)',
          dest: '/index.html',
        },
      ],
    },
  });
}

if (import.meta.main) {
  main().catch(handleBuildFailure);
}
