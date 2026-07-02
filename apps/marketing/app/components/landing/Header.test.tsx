import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'bun:test';
import React from 'react';

import { Header } from './Header';

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

const navigationLinks = [
  { label: 'Overview', href: '#overview' },
  { label: 'Platforms', href: '/home#platforms' },
  { label: 'Docs', href: '/docs' },
];

describe('Header', () => {
  it('renders desktop navigation and keeps hash links as plain anchors', () => {
    render(<Header navigationLinks={navigationLinks} />);

    const hashLink = screen.getByRole('link', { name: 'Overview' });
    const docsLink = screen.getByRole('link', { name: 'Docs' });
    const mobileTrigger = screen.getByRole('button', { name: /open navigation menu/i });

    expect(hashLink.getAttribute('href')).toBe('#overview');
    expect(hashLink.getAttribute('data-router-link')).toBeNull();

    const platformLink = screen.getByRole('link', { name: 'Platforms' });
    expect(platformLink.getAttribute('href')).toBe('/home#platforms');
    expect(platformLink.getAttribute('data-router-to')).toBe('/home');
    expect(platformLink.getAttribute('data-router-hash')).toBe('platforms');

    expect(docsLink.getAttribute('href')).toBe('/docs');
    expect(docsLink.getAttribute('data-router-link')).toBe('true');
    expect(mobileTrigger.closest('.lg\\:hidden')).toBeTruthy();
  });

  it('renders mobile dialog navigation and closes it after selecting an item', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(<Header navigationLinks={navigationLinks} />);

    const openButton = await screen.findByRole('button', { name: /open navigation menu/i });
    await user.click(openButton);

    const menu = await screen.findByRole('menu');
    expect(menu.getAttribute('aria-label')).toBe('Primary navigation');

    const hashLink = within(menu).getByRole('menuitem', { name: 'Overview' });
    const docsLink = within(menu).getByRole('menuitem', { name: 'Docs' });

    expect(hashLink.getAttribute('href')).toBe('#overview');
    expect(hashLink.getAttribute('data-router-link')).toBeNull();

    const platformLink = within(menu).getByRole('menuitem', { name: 'Platforms' });
    expect(platformLink.getAttribute('href')).toBe('/home#platforms');
    expect(platformLink.getAttribute('data-router-to')).toBe('/home');
    expect(platformLink.getAttribute('data-router-hash')).toBe('platforms');

    expect(docsLink.getAttribute('href')).toBe('/docs');
    expect(docsLink.getAttribute('data-router-link')).toBe('true');

    await user.click(hashLink);

    await waitFor(() => {
      expect(screen.queryByRole('menu')).toBeNull();
    });
  });

  it('renders responsive desktop and mobile shells without a hydration-time resize effect', () => {
    render(<Header navigationLinks={navigationLinks} />);

    expect(screen.getByRole('button', { name: /open navigation menu/i })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Primary navigation' })).toBeTruthy();
  });
});
