import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'bun:test';
import React from 'react';

import '../../../../../tests/setup/dom';

type IconProps = {
  className?: string;
};

function createMockIcon(name: string) {
  return ({ className }: IconProps) => <svg data-testid={`icon-${name}`} className={className} />;
}

vi.mock('lucide-react', () => {
  return {
    ArrowLeft: createMockIcon('ArrowLeft'),
    ArrowRight: createMockIcon('ArrowRight'),
    BarChart3: createMockIcon('BarChart3'),
    Building: createMockIcon('Building'),
    Building2: createMockIcon('Building2'),
    Calendar: createMockIcon('Calendar'),
    Check: createMockIcon('Check'),
    CheckCircle2: createMockIcon('CheckCircle2'),
    Code: createMockIcon('Code'),
    Code2: createMockIcon('Code2'),
    Command: createMockIcon('Command'),
    Copy: createMockIcon('Copy'),
    CreditCard: createMockIcon('CreditCard'),
    Globe: createMockIcon('Globe'),
    HelpCircle: createMockIcon('HelpCircle'),
    Lock: createMockIcon('Lock'),
    Menu: createMockIcon('Menu'),
    Monitor: createMockIcon('Monitor'),
    Rocket: createMockIcon('Rocket'),
    Search: createMockIcon('Search'),
    Shield: createMockIcon('Shield'),
    Smartphone: createMockIcon('Smartphone'),
    Sparkles: createMockIcon('Sparkles'),
    Target: createMockIcon('Target'),
    Terminal: createMockIcon('Terminal'),
    User: createMockIcon('User'),
    Users: createMockIcon('Users'),
    X: createMockIcon('X'),
    Zap: createMockIcon('Zap'),
  };
});

let ResourcesSection: (props: { resources: any[] }) => React.ReactElement;
let SurfacesSection: (props: { surfaces: any[] }) => React.ReactElement;
let LandingFooter: () => React.ReactElement;
let FooterLink: (props: { href: string; children: React.ReactNode }) => React.ReactElement;

beforeAll(async () => {
  ({ ResourcesSection } = await import('./Resources'));
  ({ SurfacesSection } = await import('./Surfaces'));
  ({ LandingFooter, FooterLink } = await import('./Footer'));
});

describe('Landing sections', () => {
  it('renders resources with links vs docs fallback and optional command blocks', () => {
    const resources = [
      {
        category: 'SDK',
        stack: 'TypeScript',
        slug: 'ts-sdk',
        title: 'TypeScript SDK',
        description: 'Official typed SDK.',
        command: 'bun add taskforceai-sdk',
        docsHref: '/docs/typescript-sdk',
        links: [
          { label: 'Guide', href: '/docs/guide' },
          { label: 'API', href: '/docs/api' },
        ],
      },
      {
        icon: ({ className }: IconProps) => <svg data-testid="icon-custom" className={className} />,
        category: 'REST API',
        stack: 'HTTP',
        slug: 'rest-api',
        title: 'REST API',
        description: 'Raw API access.',
        docsHref: '/docs/api',
      },
    ] as any[];

    render(<ResourcesSection resources={resources} />);

    expect(screen.getByText('Build with TaskForceAI')).toBeTruthy();
    expect(screen.getByText('bun add taskforceai-sdk')).toBeTruthy();

    const guideLink = screen.getByRole('link', { name: 'Guide' });
    expect(guideLink.getAttribute('href')).toBe('/docs/guide');
    const apiLink = screen.getByRole('link', { name: 'API' });
    expect(apiLink.getAttribute('href')).toBe('/docs/api');

    const viewDocsLink = screen.getByRole('link', { name: 'View docs' });
    expect(viewDocsLink.getAttribute('href')).toBe('/docs/api');

    expect(screen.getAllByTestId('icon-Command').length).toBeGreaterThan(1);
  });

  it('renders optional secondary surface CTAs and applies default CTA props', () => {
    const surfaces = [
      {
        name: 'Web',
        description: 'Browser-based workspace.',
        accent: 'rgba(56, 189, 248, 0.4), rgba(30, 41, 59, 0.2)',
        primaryCta: {
          label: 'Open Web App',
          href: 'https://taskforceai.chat',
          external: true,
        },
        secondaryCta: {
          label: 'Read docs',
          href: '/docs/web',
          variant: 'outline',
        },
      },
      {
        name: 'CLI',
        description: 'Terminal workflows.',
        accent: 'rgba(16, 185, 129, 0.35), rgba(15, 23, 42, 0.2)',
        primaryCta: {
          label: 'Install CLI',
          href: '/downloads',
        },
      },
    ];

    render(<SurfacesSection surfaces={surfaces} />);

    const primaryWebCta = screen.getByRole('link', { name: 'Open Web App' });
    expect(primaryWebCta.getAttribute('href')).toBe('https://taskforceai.chat');
    expect(primaryWebCta.getAttribute('target')).toBe('_blank');
    expect(primaryWebCta.getAttribute('rel')).toBe('noopener noreferrer');

    const secondaryWebCta = screen.getByRole('link', { name: 'Read docs' });
    expect(secondaryWebCta.getAttribute('href')).toBe('/docs/web');
    expect(secondaryWebCta.getAttribute('data-router-to')).toBe('/docs/web');
    expect(secondaryWebCta.getAttribute('data-preload')).toBe('false');

    const cliPrimaryCta = screen.getByRole('link', { name: 'Install CLI' });
    expect(cliPrimaryCta.getAttribute('href')).toBe('/downloads');
    expect(cliPrimaryCta.getAttribute('data-router-to')).toBe('/downloads');
    expect(screen.queryByRole('link', { name: 'CLI docs' })).toBeNull();
  });

  it('renders footer internal links via router and external links with security attrs', () => {
    render(<LandingFooter />);

    const pricingLink = screen.getByRole('link', { name: 'Pricing' });
    expect(pricingLink.getAttribute('href')).toBe('/pricing');
    expect(pricingLink.getAttribute('data-router-link')).toBe('true');

    const platformsLink = screen.getByRole('link', { name: 'Platforms' });
    expect(platformsLink.getAttribute('href')).toBe('/home#platforms');
    expect(platformsLink.getAttribute('data-router-to')).toBe('/home');
    expect(platformsLink.getAttribute('data-router-hash')).toBe('platforms');

    const docsLink = screen.getByRole('link', { name: 'Docs' });
    expect(docsLink.getAttribute('href')).toBe('https://docs.taskforceai.chat/docs');
    expect(docsLink.getAttribute('target')).toBe('_blank');
    expect(docsLink.getAttribute('rel')).toBe('noopener noreferrer');

    const statusLink = screen.getByRole('link', { name: 'Status' });
    expect(statusLink.getAttribute('href')).toBe('https://status.taskforceai.chat');

    expect(screen.getByText(/© \d{4} TaskForceAI\. All rights reserved\./)).toBeTruthy();
  });

  it('renders non-router footer links as plain anchors', () => {
    render(<FooterLink href="mailto:support@taskforceai.chat">Email support</FooterLink>);

    const supportLink = screen.getByRole('link', { name: 'Email support' });
    expect(supportLink.getAttribute('href')).toBe('mailto:support@taskforceai.chat');
    expect(supportLink.getAttribute('data-router-link')).toBeNull();
    expect(supportLink.getAttribute('target')).toBeNull();
  });
});
