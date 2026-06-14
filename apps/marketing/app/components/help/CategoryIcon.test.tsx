import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'bun:test';
import React from 'react';

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
  it('maps known icon names to their matching icon component', () => {
    const { rerender } = render(<CategoryIcon icon="Smartphone" />);
    expect(screen.getByTestId('icon-Smartphone')).toBeTruthy();

    rerender(<CategoryIcon icon="CreditCard" />);
    expect(screen.getByTestId('icon-CreditCard')).toBeTruthy();

    rerender(<CategoryIcon icon="Server" />);
    expect(screen.getByTestId('icon-Server')).toBeTruthy();
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
