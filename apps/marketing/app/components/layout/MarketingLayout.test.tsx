import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'bun:test';
import React from 'react';

import { MarketingLayout } from './MarketingLayout';

vi.mock('@unpic/react', () => ({
  Image: ({
    alt,
    layout: _layout,
    priority: _priority,
    ...props
  }: React.ComponentProps<'img'> & { layout?: string; priority?: boolean }) => (
    <img alt={alt} {...props} />
  ),
}));

function setViewportWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: width,
  });
  window.dispatchEvent(new Event('resize'));
}

describe('MarketingLayout', () => {
  it('renders header, footer, and child content in the main region', () => {
    setViewportWidth(1280);

    render(
      <MarketingLayout>
        <section>Child content</section>
      </MarketingLayout>
    );

    const child = screen.getByText('Child content');
    expect(child.closest('main')).toBeTruthy();
    const pricingLinks = screen.getAllByRole('link', { name: 'Pricing' });
    expect(pricingLinks.some((link) => link.getAttribute('href') === '/pricing')).toBe(true);

    const primaryNav = screen.getByRole('navigation', { name: 'Primary navigation' });
    expect(primaryNav.textContent).not.toContain('Benchmarks');
    const benchmarkLinks = screen.getAllByRole('link', { name: 'Benchmarks' });
    expect(benchmarkLinks.every((link) => link.getAttribute('href') === '/benchmarks')).toBe(true);

    const brandLinks = screen.getAllByRole('link', { name: /TaskForceAI/i });
    expect(brandLinks.some((link) => link.getAttribute('href') === '/')).toBe(true);
    expect(screen.getByText(/All rights reserved\./)).toBeTruthy();
  });

  it('merges custom root and container classes', () => {
    const { container } = render(
      <MarketingLayout className="custom-root" containerClassName="custom-container">
        <div>content</div>
      </MarketingLayout>
    );

    const root = container.firstElementChild as HTMLElement | null;
    const contentContainer = container.querySelector('div.max-w-6xl');

    expect(root?.className.includes('custom-root')).toBe(true);
    expect(contentContainer?.className.includes('custom-container')).toBe(true);
  });
});
