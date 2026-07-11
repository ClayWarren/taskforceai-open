import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'bun:test';
import React from 'react';

import '../../../../../tests/setup/dom';

type IconProps = { className?: string };

function createMockIcon(name: string) {
  return ({ className }: IconProps) => <svg data-testid={`icon-${name}`} className={className} />;
}

vi.mock('lucide-react', () => ({
  Rocket: createMockIcon('Rocket'),
  User: createMockIcon('User'),
  Globe: createMockIcon('Globe'),
  Monitor: createMockIcon('Monitor'),
  Smartphone: createMockIcon('Smartphone'),
  Terminal: createMockIcon('Terminal'),
  Code: createMockIcon('Code'),
  Code2: createMockIcon('Code2'),
  Building: createMockIcon('Building'),
  Building2: createMockIcon('Building2'),
  Shield: createMockIcon('Shield'),
  HelpCircle: createMockIcon('HelpCircle'),
  CreditCard: createMockIcon('CreditCard'),
  Server: createMockIcon('Server'),
}));

let CategoryIcon: (props: { icon: string; className?: string }) => React.ReactElement;

beforeAll(async () => {
  ({ CategoryIcon } = await import('./CategoryIcon'));
});

describe('CategoryIcon', () => {
  it('maps known icon names to their matching icon component with the default class', () => {
    const iconNames = [
      'Rocket',
      'User',
      'Globe',
      'Monitor',
      'Smartphone',
      'Terminal',
      'Code2',
      'Building',
      'Building2',
      'Shield',
      'CreditCard',
      'Server',
    ];

    const { rerender } = render(<CategoryIcon icon={iconNames[0] ?? 'Rocket'} />);

    for (const iconName of iconNames) {
      rerender(<CategoryIcon icon={iconName} />);
      const icon = screen.getByTestId(`icon-${iconName}`);
      expect(icon).toBeTruthy();
      expect(icon.getAttribute('class')).toBe('h-6 w-6');
    }
  });

  it('supports both Code aliases and forwards className', () => {
    const { rerender } = render(<CategoryIcon icon="Code" />);
    expect(screen.getByTestId('icon-Code')).toBeTruthy();

    rerender(<CategoryIcon icon="{ }" className="h-8 w-8" />);
    expect(screen.getByTestId('icon-Code').getAttribute('class')).toContain('h-8 w-8');
  });

  it('falls back to HelpCircle for unknown icon names', () => {
    render(<CategoryIcon icon="UnknownIcon" />);
    expect(screen.getByTestId('icon-HelpCircle')).toBeTruthy();
  });
});
