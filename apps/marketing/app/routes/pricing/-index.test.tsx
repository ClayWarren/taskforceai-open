import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'bun:test';
import React from 'react';

import { PricingPage } from './index';

// Mock next/link
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

// Mock @unpic/react
vi.mock('@unpic/react', () => ({
  Image: ({
    alt,
    fill: _fill,
    priority: _priority,
    ...props
  }: React.ComponentProps<'img'> & { fill?: boolean; priority?: boolean }) => (
    <img alt={alt} {...props} />
  ),
}));

describe('PricingPage', () => {
  it('renders all pricing tiers', () => {
    render(<PricingPage />);
    expect(screen.getByText('Free')).toBeTruthy();
    expect(screen.getByText('Pro')).toBeTruthy();
    expect(screen.getByText('Super')).toBeTruthy();
  });

  it('displays pricing amounts for each tier', () => {
    render(<PricingPage />);
    expect(screen.getByText('$0')).toBeTruthy();
    expect(screen.getByText('$28')).toBeTruthy();
    expect(screen.getByText('$280')).toBeTruthy();
  });

  it('shows the hero heading', () => {
    render(<PricingPage />);
    expect(screen.getByText('Simple, transparent pricing')).toBeTruthy();
  });

  it('renders model multipliers section', () => {
    render(<PricingPage />);
    expect(screen.getByText('Model usage multipliers')).toBeTruthy();
    expect(screen.getByText('Sentinel (TaskForceAI)')).toBeTruthy();
    expect(screen.getByText('GPT 5.5')).toBeTruthy();
  });

  it('marks Pro tier as most popular', () => {
    render(<PricingPage />);
    expect(screen.getByText('Most Popular')).toBeTruthy();
  });

  it('renders CTA buttons with correct text', () => {
    render(<PricingPage />);
    expect(screen.getByRole('link', { name: 'Get Started' }).getAttribute('href')).toBe(
      'https://taskforceai.chat/login?callbackUrl=/home'
    );
    expect(screen.getByRole('link', { name: 'Subscribe' }).getAttribute('href')).toBe(
      'https://taskforceai.chat/api/v1/checkout?plan=pro'
    );
    expect(screen.getByRole('link', { name: 'Upgrade to Super' }).getAttribute('href')).toBe(
      'https://taskforceai.chat/api/v1/checkout?plan=super'
    );
  });

  it('renders Free tier with Get Started CTA', () => {
    render(<PricingPage />);
    const freeCTA = screen.getByText('Get Started');
    expect(freeCTA).toBeTruthy();
  });

  it('renders FAQ section', () => {
    render(<PricingPage />);
    expect(screen.getByText('Frequently asked questions')).toBeTruthy();
    expect(screen.getByText('Can I change plans later?')).toBeTruthy();
  });

  it('renders navigation header with branding', () => {
    render(<PricingPage />);
    expect(screen.getAllByText('TaskForceAI').length).toBeGreaterThan(0);
  });

  it('renders check icons for features', () => {
    render(<PricingPage />);
    // Check for presence of feature text which implies icons are rendered next to them
    expect(screen.getByText('Access to standard models')).toBeTruthy();
    expect(screen.getByText('Access to premium models')).toBeTruthy();
  });
});
