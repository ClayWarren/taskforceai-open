import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'bun:test';

import { PricingPage } from './index';

describe('PricingPage', () => {
  it('renders plans, canonical checkout links, model cost tiers, and FAQs', () => {
    render(<PricingPage />);
    expect(screen.getByText('Free')).toBeTruthy();
    expect(screen.getByText('Pro')).toBeTruthy();
    expect(screen.getByText('Super')).toBeTruthy();
    expect(screen.getByText('$0')).toBeTruthy();
    expect(screen.getByText('$28')).toBeTruthy();
    expect(screen.getByText('$280')).toBeTruthy();
    expect(screen.getByText('Simple, transparent pricing')).toBeTruthy();
    expect(screen.getByText('Model cost tiers')).toBeTruthy();
    expect(screen.getByText('Sentinel (TaskForceAI)')).toBeTruthy();
    expect(screen.getByText('GPT 5.6 Sol')).toBeTruthy();
    expect(screen.getByText('GPT 5.6 Terra')).toBeTruthy();
    expect(screen.getByText('GPT 5.6 Luna')).toBeTruthy();
    expect(screen.getAllByText('$$$+')).toHaveLength(2);
    expect(screen.getAllByText('$$$')).toHaveLength(2);
    expect(screen.getAllByText('$$')).toHaveLength(3);
    expect(screen.getByText('Most Popular')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Get Started' }).getAttribute('href')).toBe(
      'https://taskforceai.chat/login?callbackUrl=/home'
    );
    expect(screen.getByRole('link', { name: 'Subscribe' }).getAttribute('href')).toBe(
      'https://taskforceai.chat/api/v1/checkout?plan=pro'
    );
    expect(screen.getByRole('link', { name: 'Upgrade to Super' }).getAttribute('href')).toBe(
      'https://taskforceai.chat/api/v1/checkout?plan=super'
    );
    expect(screen.getByText('Frequently asked questions')).toBeTruthy();
    expect(screen.getByText('Can I change plans later?')).toBeTruthy();
    expect(screen.getAllByText('TaskForceAI').length).toBeGreaterThan(0);
    expect(screen.getByText('Access to $ and $$ models')).toBeTruthy();
    expect(screen.getByText('Unlock $$$ and $$$+ models')).toBeTruthy();
    expect(screen.queryByText(/unlimited messages/i)).toBeNull();
    expect(screen.getAllByText('Same allowance across apps and API')).toHaveLength(2);
  });
});
