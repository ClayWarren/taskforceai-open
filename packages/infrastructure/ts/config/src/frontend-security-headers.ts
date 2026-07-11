export type FrontendSecurityApp = 'admin' | 'console' | 'marketing' | 'status' | 'web';

export type FrontendSecurityEnvironment = 'development' | 'production';

export interface FrontendSecurityHeaderOptions {
  environment?: FrontendSecurityEnvironment;
  includeStrictTransportSecurity?: boolean;
}

export const FRONTEND_STRICT_TRANSPORT_SECURITY = 'max-age=31536000; includeSubDomains; preload';

const TASKFORCE_CONNECT_SRC = [
  "'self'",
  'https://taskforceai.chat',
  'https://*.taskforceai.chat',
  'https://api.taskforceai.chat',
  'https://api.vercel.ai',
  'https://vitals.vercel-insights.com',
  'https://*.sentry.io',
  'https://*.ingest.sentry.io',
  'https://*.public.blob.vercel-storage.com',
  'wss://*.taskforceai.chat',
];

const WEB_FEATURE_FLAG_CONNECT_SRC = [
  'https://featureassets.org',
  'https://assetsconfigcdn.org',
  'https://prodregistryv2.org',
  'https://beyondwickedmapping.org',
  'https://statsigapi.net',
];

const WEB_REALTIME_VOICE_CONNECT_SRC = ['wss://ai-gateway.vercel.sh'];

const joinDirective = (name: string, values: readonly string[]): string =>
  `${name} ${values.join(' ')}`;

const webScriptSrc = (environment: FrontendSecurityEnvironment): string =>
  environment === 'production'
    ? joinDirective('script-src', [
        "'self'",
        "'unsafe-inline'",
        'https://js.stripe.com',
        'https://va.vercel-scripts.com',
        'https://vercel.live',
        'blob:',
      ])
    : "script-src 'self' 'unsafe-eval' 'unsafe-inline' https: blob:";

const webStyleSrc = (environment: FrontendSecurityEnvironment): string =>
  environment === 'production'
    ? "style-src 'self' 'unsafe-inline'"
    : "style-src 'self' 'unsafe-inline'";

const webConnectSrc = (environment: FrontendSecurityEnvironment): string =>
  environment === 'production'
    ? joinDirective('connect-src', [
        ...TASKFORCE_CONNECT_SRC,
        ...WEB_FEATURE_FLAG_CONNECT_SRC,
        ...WEB_REALTIME_VOICE_CONNECT_SRC,
        'ipc://localhost',
      ])
    : "connect-src 'self' https: wss: ipc://localhost";

const webFrameSrc = (environment: FrontendSecurityEnvironment): string =>
  environment === 'production'
    ? "frame-src 'self' https://js.stripe.com https://*.stripe.com"
    : "frame-src 'self' https: data:";

const appScriptSrc = (environment: FrontendSecurityEnvironment): string =>
  environment === 'production'
    ? "script-src 'self' 'unsafe-inline' https://va.vercel-scripts.com https://vercel.live blob:"
    : "script-src 'self' 'unsafe-eval' 'unsafe-inline' https: blob:";

const appStyleSrc = (environment: FrontendSecurityEnvironment): string =>
  environment === 'production'
    ? "style-src 'self' 'unsafe-inline'"
    : "style-src 'self' 'unsafe-inline'";

const appConnectSrc = (environment: FrontendSecurityEnvironment): string =>
  environment === 'production'
    ? joinDirective('connect-src', TASKFORCE_CONNECT_SRC)
    : "connect-src 'self' https: wss:";

const appFrameSrc = (environment: FrontendSecurityEnvironment): string =>
  environment === 'production' ? "frame-src 'self'" : "frame-src 'self' https: data:";

const statusConnectSrc = (environment: FrontendSecurityEnvironment): string =>
  environment === 'production'
    ? "connect-src 'self' https://api.taskforceai.chat https://*.sentry.io https://*.public.blob.vercel-storage.com"
    : "connect-src 'self' https: wss:";

const commonDirectives = (connectSrc: string, frameSrc: string): string[] => [
  "default-src 'self'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  connectSrc,
  frameSrc,
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
];

export const buildFrontendContentSecurityPolicy = (
  app: FrontendSecurityApp,
  options: Pick<FrontendSecurityHeaderOptions, 'environment'> = {}
): string => {
  const environment = options.environment ?? 'production';

  if (app === 'web') {
    return [
      "default-src 'self'",
      webScriptSrc(environment),
      webStyleSrc(environment),
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      webConnectSrc(environment),
      webFrameSrc(environment),
      "worker-src 'self' blob:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ');
  }

  if (app === 'status') {
    return [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      ...commonDirectives(statusConnectSrc(environment), "frame-src 'self'").slice(1),
    ].join('; ');
  }

  return [
    "default-src 'self'",
    appScriptSrc(environment),
    appStyleSrc(environment),
    ...commonDirectives(appConnectSrc(environment), appFrameSrc(environment)).slice(1),
  ].join('; ');
};

export const getFrontendSecurityHeaders = (
  app: FrontendSecurityApp,
  options: FrontendSecurityHeaderOptions = {}
): Record<string, string> => {
  const environment = options.environment ?? 'production';
  const includeStrictTransportSecurity =
    options.includeStrictTransportSecurity ?? environment === 'production';

  return {
    'Content-Security-Policy': buildFrontendContentSecurityPolicy(app, { environment }),
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'X-XSS-Protection': '0',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(self), geolocation=()',
    ...(includeStrictTransportSecurity
      ? { 'Strict-Transport-Security': FRONTEND_STRICT_TRANSPORT_SECURITY }
      : {}),
  };
};
