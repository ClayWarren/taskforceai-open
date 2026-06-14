import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'bun:test';

import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from './popover';

describe('Popover', () => {
  it('renders trigger', () => {
    render(
      <Popover>
        <PopoverTrigger>Open Popover</PopoverTrigger>
        <PopoverContent>Popover Body</PopoverContent>
      </Popover>
    );

    expect(screen.getByText('Open Popover')).toBeTruthy();
  });

  it('opens content when trigger is clicked', async () => {
    render(
      <Popover>
        <PopoverTrigger>Open</PopoverTrigger>
        <PopoverContent>Content</PopoverContent>
      </Popover>
    );

    expect(screen.queryByText('Content')).toBeNull();

    fireEvent.click(screen.getByText('Open'));

    await waitFor(() => {
      expect(screen.getByText('Content')).toBeTruthy();
    });
  });

  it('applies custom classes to content', async () => {
    render(
      <Popover defaultOpen>
        <PopoverTrigger>Open</PopoverTrigger>
        <PopoverContent className="custom-popover" data-testid="popover-content">
          Content
        </PopoverContent>
      </Popover>
    );

    await waitFor(() => {
      const content = screen.getByTestId('popover-content');
      expect(content.className).toContain('custom-popover');
      expect(content.className).toContain('z-50');
      expect(content.className).toContain('bg-popover');
    });
  });

  it('supports align prop', async () => {
    render(
      <Popover defaultOpen>
        <PopoverTrigger>Open</PopoverTrigger>
        <PopoverContent align="start" data-testid="popover-content">
          Content
        </PopoverContent>
      </Popover>
    );

    await waitFor(() => {
      const content = screen.getByTestId('popover-content');
      expect(content.getAttribute('data-align')).toBe('start');
    });
  });

  it('renders anchor', () => {
    render(
      <Popover>
        <PopoverAnchor data-testid="popover-anchor">Anchor</PopoverAnchor>
        <PopoverContent>Content</PopoverContent>
      </Popover>
    );

    expect(screen.getByTestId('popover-anchor')).toBeTruthy();
  });
});
