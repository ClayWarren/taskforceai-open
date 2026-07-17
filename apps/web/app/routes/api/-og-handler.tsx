import { createAppLogger } from '@taskforceai/observability';
import { env } from '../../lib/config/env';

const { logger } = createAppLogger({
  app: 'web',
  environment: env.NODE_ENV,
  runtime: 'server',
  bridgeConsole: false,
  preserveNativeConsole: true,
});

export const handleOgImageRequest = async (request: Request): Promise<Response> => {
  const startedAt = Date.now();
  try {
    const { ImageResponse } = await import('@vercel/og');

    const url = new URL(request.url);
    const title = (url.searchParams.get('title') || 'TaskForceAI').slice(0, 100);
    const description = (
      url.searchParams.get('description') || 'Multi-agent AI orchestration powered by TaskForceAI'
    ).slice(0, 200);

    const response = new ImageResponse(
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#0a0a0a',
          backgroundImage:
            'radial-gradient(circle at 25px 25px, #1a1a1a 2%, transparent 0%), radial-gradient(circle at 75px 75px, #1a1a1a 2%, transparent 0%)',
          backgroundSize: '100px 100px',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 40,
          }}
        >
          <svg
            width="80"
            height="80"
            viewBox="0 0 100 100"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <circle cx="50" cy="50" r="45" stroke="url(#grad)" strokeWidth="4" fill="none" />
            <path
              d="M30 50 L45 65 L70 35"
              stroke="#22c55e"
              strokeWidth="6"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
            <defs>
              <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#3b82f6" />
                <stop offset="100%" stopColor="#8b5cf6" />
              </linearGradient>
            </defs>
          </svg>
        </div>
        <div
          style={{
            display: 'flex',
            fontSize: 60,
            fontWeight: 700,
            background: 'linear-gradient(90deg, #3b82f6, #8b5cf6)',
            backgroundClip: 'text',
            color: 'transparent',
            marginBottom: 20,
            textAlign: 'center',
            maxWidth: '80%',
          }}
        >
          {title}
        </div>
        <div
          style={{
            display: 'flex',
            fontSize: 28,
            color: '#a1a1aa',
            textAlign: 'center',
            maxWidth: '70%',
          }}
        >
          {description}
        </div>
      </div>,
      {
        width: 1200,
        height: 630,
      }
    );
    response.headers.set(
      'Cache-Control',
      'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800'
    );
    return response;
  } catch (error) {
    logger.error('OG image generation failed, falling back to icon', {
      error,
      pathname: new URL(request.url).pathname,
      correlationId: request.headers.get('x-correlation-id') ?? undefined,
      durationMs: Date.now() - startedAt,
    });

    return new Response(null, {
      status: 302,
      headers: {
        Location: '/icon.png',
      },
    });
  }
};
