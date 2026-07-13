import { createCsrfMiddleware, createMiddleware, createStart } from '@tanstack/react-start';

export type FrontendStartEnvironment = 'development' | 'production';
type SecurityHeaders = (environment: FrontendStartEnvironment) => Record<string, string>;

export function createFrontendStart(
  environment: FrontendStartEnvironment,
  getSecurityHeaders: SecurityHeaders
) {
  const securityHeadersMiddleware = createMiddleware({ type: 'request' }).server(
    async ({ next }) => {
      const result = await next();
      const headers = new Headers(result.response.headers);

      for (const [key, value] of Object.entries(getSecurityHeaders(environment))) {
        headers.set(key, value);
      }

      return new Response(result.response.body, {
        status: result.response.status,
        statusText: result.response.statusText,
        headers,
      });
    }
  );
  const csrfMiddleware = createCsrfMiddleware({
    filter: (context) => context.handlerType === 'serverFn',
  });

  return createStart(() => ({
    requestMiddleware: [securityHeadersMiddleware, csrfMiddleware],
  }));
}
