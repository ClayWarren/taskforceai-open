import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, mock, vi } from 'bun:test';
import '../../../../../tests/setup/dom';

// Mock dependencies using Bun's mock.module AT THE TOP
mock.module('@taskforceai/ui-kit/CookieBanner', () => ({
  hasAnalyticsConsent: vi.fn(),
}));

const CookieBanner = await import('@taskforceai/ui-kit/CookieBanner');
const { Analytics } = await import('./Analytics');

type HappyDomWindow = typeof window & {
  happyDOM?: {
    settings?: {
      handleDisabledFileLoadingAsSuccess?: boolean;
    };
  };
};

describe('Analytics', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    const happyDomSettings = (window as HappyDomWindow).happyDOM?.settings;
    if (happyDomSettings) {
      happyDomSettings.handleDisabledFileLoadingAsSuccess = true;
    }
    document.head.querySelectorAll('script').forEach((script) => script.remove());
    delete (window as typeof window & { va?: unknown }).va;
    delete (window as typeof window & { vaq?: unknown }).vaq;
    delete (window as typeof window & { vam?: unknown }).vam;
    delete (window as typeof window & { si?: unknown }).si;
    delete (window as typeof window & { siq?: unknown }).siq;
  });

  it('renders nothing if no consent', () => {
    vi.spyOn(CookieBanner, 'hasAnalyticsConsent').mockReturnValue(false);

    const { container } = render(<Analytics />);
    expect(container.firstChild).toBeNull();
    expect(document.head.querySelector('script[src*="vercel"]')).toBeNull();
  });

  it('loads analytics scripts when consented', async () => {
    vi.spyOn(CookieBanner, 'hasAnalyticsConsent').mockReturnValue(true);
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { container } = render(<Analytics />);

    expect(container.firstChild).toBeNull();

    await waitFor(() => {
      expect(document.head.querySelector('script[src="/_vercel/insights/script.js"]')).toBeTruthy();
      expect(
        document.head.querySelector('script[src="/_vercel/speed-insights/script.js"]')
      ).toBeTruthy();
    });
    expect((window as typeof window & { va?: unknown }).va).toBeFunction();
    expect((window as typeof window & { si?: unknown }).si).toBeFunction();

    (window as typeof window & { va: (...params: unknown[]) => void }).va('event', {
      name: 'pageview',
    });
    (window as typeof window & { si: (...params: unknown[]) => void }).si('metric', {
      value: 42,
    });

    expect((window as typeof window & { vaq?: unknown[][] }).vaq).toEqual([
      ['event', { name: 'pageview' }],
    ]);
    expect((window as typeof window & { siq?: unknown[][] }).siq).toEqual([
      ['metric', { value: 42 }],
    ]);

    document.head
      .querySelector('script[src="/_vercel/insights/script.js"]')
      ?.dispatchEvent(new Event('error'));
    document.head
      .querySelector('script[src="/_vercel/speed-insights/script.js"]')
      ?.dispatchEvent(new Event('error'));
    expect(consoleLog).toHaveBeenCalledWith(
      '[Vercel Web Analytics] Failed to load analytics script.'
    );
    expect(consoleLog).toHaveBeenCalledWith(
      '[Vercel Speed Insights] Failed to load speed insights script.'
    );
  });
});
