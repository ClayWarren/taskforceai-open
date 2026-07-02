'use client';

import { Analytics as VercelAnalytics } from '@vercel/analytics/react';
import { SpeedInsights as VercelSpeedInsights } from '@vercel/speed-insights/react';

import { hasAnalyticsConsent } from '@taskforceai/ui-kit/CookieBanner';

export function Analytics() {
  // Lazy load to avoid SSR issues
  if (typeof window === 'undefined') return null;

  // Only load analytics if user has consented
  if (!hasAnalyticsConsent()) return null;

  return (
    <>
      <VercelAnalytics />
      <VercelSpeedInsights />
    </>
  );
}
