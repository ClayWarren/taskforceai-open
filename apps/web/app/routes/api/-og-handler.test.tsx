import { beforeEach, describe, expect, it, vi } from 'bun:test';

const mockImageResponse = vi.fn((element: unknown, options: { width: number; height: number }) => ({
  element,
  options,
}));

vi.mock('@vercel/og', () => ({
  ImageResponse: mockImageResponse,
}));

import { handleOgImageRequest } from './-og-handler';

describe('handleOgImageRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockImageResponse.mockImplementation(
      ((_element: unknown, _options: { width: number; height: number }) =>
        new Response('ok', { status: 200 })) as unknown as typeof mockImageResponse
    );
  });

  it('renders an OG image with query params', async () => {
    const request = new Request('https://taskforceai.chat/api/og?title=Hello&description=World');
    const response = await handleOgImageRequest(request);

    expect(response.status).toBe(200);
    expect(mockImageResponse).toHaveBeenCalledTimes(1);
    const [, options] = mockImageResponse.mock.calls[0] ?? [];
    expect(options).toEqual({ width: 1200, height: 630 });
  });

  it('falls back to the static icon when image rendering fails', async () => {
    mockImageResponse.mockImplementationOnce(() => {
      throw new Error('render failed');
    });

    const response = await handleOgImageRequest(new Request('https://taskforceai.chat/api/og'));

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/icon.png');
  });
});
