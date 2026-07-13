import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'bun:test';
import React from 'react';

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
