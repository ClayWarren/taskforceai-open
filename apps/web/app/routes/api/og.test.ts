import { describe, expect, it, vi } from 'bun:test';

const handleOgImageRequest = vi.fn(async (request: Request) => new Response(request.url));
let capturedRouteConfig: any;

vi.mock('@tanstack/react-start', () => ({}));

vi.mock('@tanstack/react-router', () => ({
  createRouter: vi.fn(),
  createFileRoute: vi.fn(() => (config: any) => {
    capturedRouteConfig = config;
    return config;
  }),
}));

vi.mock('./-og-handler', () => ({
  handleOgImageRequest,
}));

await import('./og');

describe('OG route', () => {
  it('delegates GET requests to the OG image handler', async () => {
    const request = new Request('https://taskforceai.example/api/og?title=Launch');

    const response = await capturedRouteConfig.server.handlers.GET({ request });

    expect(await response.text()).toBe('https://taskforceai.example/api/og?title=Launch');
    expect(handleOgImageRequest).toHaveBeenCalledWith(request);
  });
});
