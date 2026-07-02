import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'bun:test';
import React from 'react';

vi.mock('@/env', () => ({
  env: {
    NEXT_PUBLIC_MOBILE_IOS_APP_URL: undefined,
    NEXT_PUBLIC_MOBILE_ANDROID_APP_URL: undefined,
  },
}));

const { Route: MobileRoute } = await import('./mobile/index');

describe('Mobile route fallbacks', () => {
  it('renders hash fallback download links as plain anchors', () => {
    const MobilePage = MobileRoute.options.component as React.ComponentType;
    render(<MobilePage />);

    const androidLink = screen.getByRole('link', { name: /Install for Android/i });
    expect(androidLink.getAttribute('href')).toBe('#android-install');
    expect(androidLink.getAttribute('data-router-link')).toBeNull();
    expect(androidLink.getAttribute('target')).toBeNull();
    expect(screen.getByText('Beta link coming soon')).toBeTruthy();
  });
});
