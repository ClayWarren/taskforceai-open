import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'bun:test';

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip';

describe('Tooltip', () => {
  it('renders trigger', () => {
    render(
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>Hover me</TooltipTrigger>
          <TooltipContent>Tooltip text</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );

    expect(screen.getByText('Hover me')).toBeTruthy();
  });

  it('shows content on focus (simulating trigger)', async () => {
    render(
      <TooltipProvider>
        <Tooltip defaultOpen>
          <TooltipTrigger>Hover me</TooltipTrigger>
          <TooltipContent>Tooltip text</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );

    await waitFor(() => {
      expect(screen.getAllByText('Tooltip text').length).toBeGreaterThan(0);
    });
  });

  it('applies custom classes to content', async () => {
    render(
      <TooltipProvider>
        <Tooltip defaultOpen>
          <TooltipTrigger>Hover me</TooltipTrigger>
          <TooltipContent className="custom-tooltip" data-testid="tooltip-content">
            Tooltip text
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );

    await waitFor(() => {
      const content = screen.getByTestId('tooltip-content');
      expect(content.className).toContain('custom-tooltip');
      expect(content.className).toContain('z-50');
      expect(content.className).toContain('bg-primary');
    });
  });

  it('passes sideOffset prop', async () => {
    // Note: checking this prop directly in DOM is tricky as it affects positioning styles
    // We just verify it renders without error
    render(
      <TooltipProvider>
        <Tooltip defaultOpen>
          <TooltipTrigger>Hover me</TooltipTrigger>
          <TooltipContent sideOffset={10} data-testid="tooltip-content">
            Tooltip text
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('tooltip-content')).toBeTruthy();
    });
  });
});
