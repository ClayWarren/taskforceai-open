import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'bun:test';

import { Separator } from './separator';

describe('Separator', () => {
  it('renders correctly', () => {
    render(<Separator data-testid="separator" />);
    const separator = screen.getByTestId('separator');
    expect(separator).toBeTruthy();
    expect(separator.className).toContain('shrink-0');
    expect(separator.className).toContain('bg-border');
  });

  it('defaults to horizontal orientation', () => {
    render(<Separator data-testid="separator" />);
    const separator = screen.getByTestId('separator');
    expect(separator.className).toContain('h-[1px]');
    expect(separator.className).toContain('w-full');
    expect(separator.getAttribute('data-orientation')).toBe('horizontal');
  });

  it('supports vertical orientation', () => {
    render(<Separator orientation="vertical" data-testid="separator" />);
    const separator = screen.getByTestId('separator');
    expect(separator.className).toContain('h-full');
    expect(separator.className).toContain('w-[1px]');
    expect(separator.getAttribute('data-orientation')).toBe('vertical');
  });

  it('merges custom className', () => {
    render(<Separator className="custom-sep" data-testid="separator" />);
    const separator = screen.getByTestId('separator');
    expect(separator.className).toContain('custom-sep');
  });

  it('supports decorative prop', () => {
    render(<Separator decorative={false} data-testid="separator" />);
    // Not directly testable via simple DOM query as it mainly affects a11y tree,
    // but verifying it renders without crashing is good.
    expect(screen.getByTestId('separator')).toBeTruthy();
  });
});
