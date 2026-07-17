import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'bun:test';
import type React from 'react';

import '../../../../tests/setup/dom';

let SupportRoute: any;

beforeAll(async () => {
  ({ Route: SupportRoute } = await import('./support'));
});

describe('support route', () => {
  it('exports support page metadata', () => {
    const head = SupportRoute.options.head();

    expect(head.meta).toContainEqual({ title: 'TaskForceAI Support' });
    expect(head.meta).toContainEqual({
      name: 'description',
      content:
        'Contact TaskForceAI support and find help for account, billing, privacy, and app issues.',
    });
    expect(head.meta).toContainEqual({
      property: 'og:url',
      content: 'https://www.taskforceai.chat/support',
    });
    expect(head.links).toContainEqual({
      rel: 'canonical',
      href: 'https://www.taskforceai.chat/support',
    });
  });

  it('renders support entry points for contact, help, and privacy information', () => {
    const SupportPage = SupportRoute.options.component as React.ComponentType;

    render(<SupportPage />);

    expect(screen.getByRole('heading', { level: 1, name: 'TaskForceAI Support' })).toBeTruthy();
    expect(screen.getAllByRole('main')).toHaveLength(1);

    expect(screen.getByRole('link', { name: /contact support/i }).getAttribute('href')).toBe(
      'mailto:support@taskforceai.chat'
    );
    expect(
      screen.getAllByRole('link', { name: /help center/i }).some((link) => {
        return link.getAttribute('href') === '/help';
      })
    ).toBe(true);
    expect(screen.getByRole('link', { name: /privacy and ai/i }).getAttribute('href')).toBe(
      '/help/privacy-security/ai-provider-data-sharing'
    );
  });
});
