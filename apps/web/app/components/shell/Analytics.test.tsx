import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, mock, vi } from 'bun:test';
import * as React from 'react';

import { Analytics } from './Analytics';
import * as CookieBanner from '@taskforceai/ui-kit';

// Mock dependencies using Bun's mock.module AT THE TOP
mock.module('@taskforceai/ui-kit', () => ({
  hasAnalyticsConsent: vi.fn(),
}));

mock.module('@vercel/analytics/react', () => ({
  Analytics: (props: any) =>
    React.createElement('div', { 'data-testid': 'vercel-analytics', ...props }),
}));

mock.module('@vercel/speed-insights/react', () => ({
  SpeedInsights: (props: any) =>
    React.createElement('div', { 'data-testid': 'vercel-speed-insights', ...props }),
}));

describe('Analytics', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('renders nothing if no consent', () => {
    vi.spyOn(CookieBanner, 'hasAnalyticsConsent').mockReturnValue(false);

    const { container } = render(<Analytics />);
    expect(container.firstChild).toBeNull();
  });

  it('renders analytics components when consented', () => {
    vi.spyOn(CookieBanner, 'hasAnalyticsConsent').mockReturnValue(true);

    const { getByTestId } = render(<Analytics />);

    expect(getByTestId('vercel-analytics')).toBeTruthy();
    expect(getByTestId('vercel-speed-insights')).toBeTruthy();
  });
});
