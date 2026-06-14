#!/usr/bin/env bun
import {
  buildStaticSpaOutput,
  filesystemRoute,
  handleBuildFailure,
  route,
} from '../../../scripts/vercel/build-output';

const REQUIRED_STATUS_JSON_ENV = 'VITE_STATUS_JSON_URL';
const API_STATUS_URL = 'https://api.taskforceai.chat/api/v1/status';

function isVercelBuild(): boolean {
  return process.env['VERCEL'] === '1' || Boolean(process.env['VERCEL_ENV']);
}

function assertStatusJsonUrl(): void {
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
}

async function main(): Promise<void> {
  assertStatusJsonUrl();

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
        route('/status.json', 'https://api.taskforceai.chat/api/v1/status'),
        route('/api/v1/(.*)', 'https://api.taskforceai.chat/api/v1/$1'),
        {
          src: '/((?!api/|assets/|.*\\.(?:json|png|jpg|ico|svg|txt)$).*)',
          dest: '/index.html',
        },
      ],
    },
  });
}

main().catch(handleBuildFailure);
