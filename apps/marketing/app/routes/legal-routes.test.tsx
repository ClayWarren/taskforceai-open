import { render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'bun:test';
import React from 'react';

const renderMarkdownCalls: string[] = [];

let mockRenderImpl = (markdown: string) => `<article>${markdown}</article>`;

const resetMockState = () => {
  renderMarkdownCalls.length = 0;
  mockRenderImpl = (markdown: string) => `<article>${markdown}</article>`;
};

vi.mock('@/lib/safe-markdown', () => ({
  renderMarkdownToSafeHtml: (markdown: string) => {
    renderMarkdownCalls.push(markdown);
    return mockRenderImpl(markdown);
  },
}));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (_path: string) => (options: any) => ({ options }),
  Link: ({
    children,
    to,
    ...props
  }: {
    children: React.ReactNode;
    to: string;
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={to} data-router-link="true" {...props}>
      {children}
    </a>
  ),
}));

let PrivacyRoute: any;
let TermsRoute: any;

beforeAll(async () => {
  ({ Route: PrivacyRoute } = await import('./(legal)/privacy/index'));
  ({ Route: TermsRoute } = await import('./(legal)/terms/index'));
});

beforeEach(() => {
  resetMockState();
});

afterEach(() => {
  resetMockState();
});

describe('Legal routes', () => {
  it('renders privacy policy from sanitized markdown html', () => {
    mockRenderImpl = () => '<h1>Privacy Policy</h1>';

    const PrivacyPage = PrivacyRoute.options.component as React.ComponentType;
    render(<PrivacyPage />);

    expect(screen.getByText('Privacy Policy')).toBeTruthy();
    expect(renderMarkdownCalls.length).toBe(1);
    expect(renderMarkdownCalls[0]?.includes('Privacy Policy')).toBe(true);
    expect(screen.queryByText('bad()')).toBeNull();
  });

  it('renders terms of service from sanitized markdown html', () => {
    mockRenderImpl = () => '<h1>Terms of Service</h1><p>Terms copy</p>';

    const TermsPage = TermsRoute.options.component as React.ComponentType;
    render(<TermsPage />);

    expect(screen.getByText('Terms of Service')).toBeTruthy();
    expect(renderMarkdownCalls.length).toBe(1);
    expect(renderMarkdownCalls[0]?.includes('Terms and Conditions')).toBe(true);
    expect(screen.getByText('Terms copy')).toBeTruthy();
  });
});
