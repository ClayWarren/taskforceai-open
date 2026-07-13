import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'bun:test';

import '../../../../../tests/setup/dom';
import {
  AppsIcon,
  DataIcon,
  FinanceIcon,
  GeneralIcon,
  KeyboardIcon,
  NotificationsIcon,
  PersonalizationIcon,
  SecurityIcon,
  StorageIcon,
  SubscriptionIcon,
} from './ProfileModalIcons';

const icons = [
  ['general', GeneralIcon],
  ['keyboard', KeyboardIcon],
  ['security', SecurityIcon],
  ['storage', StorageIcon],
  ['notifications', NotificationsIcon],
  ['personalization', PersonalizationIcon],
  ['subscription', SubscriptionIcon],
  ['data', DataIcon],
  ['finance', FinanceIcon],
  ['apps', AppsIcon],
] as const;

describe('ProfileModalIcons', () => {
  it.each(icons)('renders the %s icon as a compact decorative svg', (label, Icon) => {
    render(
      <span data-testid={label}>
        <Icon />
      </span>
    );

    const container = screen.getByTestId(label);
    const svg = container.querySelector('svg');

    expect(svg).toBeTruthy();
    expect(svg?.classList.contains('size-4')).toBe(true);
  });
});
