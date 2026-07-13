import { route, temporaryRedirectRoute, type JsonObject } from './build-output';

const SERVICE_ORIGINS = {
  api: 'https://api.taskforceai.chat',
  auth: 'https://auth.taskforceai.chat',
  billing: 'https://billing.taskforceai.chat',
  developer: 'https://developer.taskforceai.chat',
  docs: 'https://docs.taskforceai.chat',
  engine: 'https://engine.taskforceai.chat',
  marketing: 'https://marketing.taskforceai.chat',
  sync: 'https://sync.taskforceai.chat',
} as const;

type ServiceName = keyof typeof SERVICE_ORIGINS;

const serviceURL = (service: ServiceName, path: string): string =>
  `${SERVICE_ORIGINS[service]}${path}`;

export const serviceRoute = (src: string, service: ServiceName, dest: string): JsonObject =>
  route(src, serviceURL(service, dest));

export const marketingRoute = (src: string, dest = src): JsonObject =>
  serviceRoute(src, 'marketing', dest);

export const docsRoute = (src: string, dest = src): JsonObject => serviceRoute(src, 'docs', dest);

export const authLogoutRedirect = (): JsonObject =>
  temporaryRedirectRoute('/auth/logout', serviceURL('auth', '/api/v1/auth/logout'));

export const buildOutputAuthProxyRoutes = (): JsonObject[] => [
  serviceRoute('/api/auth/(.*)', 'auth', '/api/auth/$1'),
  serviceRoute('/api/v1/auth/(.*)', 'auth', '/api/v1/auth/$1'),
];

export const buildOutputCoreFallbackRoutes = (): JsonObject[] => [
  serviceRoute('/api/v1/(.*)', 'api', '/api/v1/$1'),
  serviceRoute('/api/(.*)', 'api', '/api/$1'),
];

const buildOutputWebLocalApiRoutes = (): JsonObject[] => [
  route('/api/realtime/(.*)', '/index'),
  route('/api/dictation/(.*)', '/index'),
  route('/api/speech/(.*)', '/index'),
];

export const buildOutputConsoleApiRoutes = (): JsonObject[] => [
  ...buildOutputAuthProxyRoutes(),
  serviceRoute('/api/v1/developer/(.*)', 'developer', '/api/v1/developer/$1'),
  serviceRoute('/api/v1/payments/(.*)', 'billing', '/api/v1/payments/$1'),
  serviceRoute('/api/v1/checkout/(.*)', 'billing', '/api/v1/checkout/$1'),
  ...buildOutputCoreFallbackRoutes(),
];

export const buildOutputWebApiRoutes = (): JsonObject[] => [
  ...buildOutputAuthProxyRoutes(),
  ...buildOutputWebLocalApiRoutes(),
  serviceRoute('/api/v1/sync/(.*)', 'sync', '/api/v1/sync/$1'),
  serviceRoute('/api/v1/remote/(.*)', 'sync', '/api/v1/remote/$1'),
  serviceRoute('/api/v1/payments/(.*)', 'billing', '/api/v1/payments/$1'),
  serviceRoute('/api/v1/checkout/(.*)', 'billing', '/api/v1/checkout/$1'),
  serviceRoute('/api/v1/voice/reserve', 'engine', '/api/v1/voice/reserve'),
  serviceRoute('/api/v1/run', 'engine', '/api/v1/run'),
  serviceRoute('/api/v1/run/(.*)', 'engine', '/api/v1/run/$1'),
  serviceRoute('/api/v1/integrations/(.*)', 'engine', '/api/v1/integrations/$1'),
  serviceRoute('/api/v1/stream/(.*)', 'engine', '/api/v1/stream/$1'),
  serviceRoute('/api/v1/tasks/active', 'engine', '/api/v1/tasks/active'),
  serviceRoute('/api/v1/tasks/(.*)/cancel', 'engine', '/api/v1/tasks/$1/cancel'),
  serviceRoute('/api/v1/tasks/(.*)/trace', 'engine', '/api/v1/tasks/$1/trace'),
  serviceRoute('/api/v1/tasks/(.*)/approve', 'engine', '/api/v1/tasks/$1/approve'),
  serviceRoute('/api/v1/developer/(.*)', 'developer', '/api/v1/developer/$1'),
  serviceRoute('/api/download/(.*)', 'api', '/api/download/$1'),
  ...buildOutputCoreFallbackRoutes(),
];
