import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'bun:test';

import { BrandMark, SimpleBrandMark } from './BrandMark';

describe('BrandMark', () => {
  it('uses theme-aware text classes instead of hardcoded white text', () => {
    render(<BrandMark />);

    const title = screen.getByText('TaskForceAI');
    expect(title.className).toContain('text-foreground');
    expect(title.className).not.toContain('text-white');

    const subtitle = screen.getByText('System Status');
    expect(subtitle.className).toContain('text-muted-foreground');
  });

  it('uses theme-aware text class in SimpleBrandMark', () => {
    render(<SimpleBrandMark />);

    const title = screen.getByText('TaskForceAI');
    expect(title.className).toContain('text-foreground');
    expect(title.className).not.toContain('text-white');
  });
});
