import { act } from 'react';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'bun:test';

import { TooltipProvider } from '@taskforceai/ui-kit/tooltip';
import { formatUptimeDate, UptimeBar } from './UptimeBar';

function isoDateDaysAgo(daysAgo: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

describe('UptimeBar', () => {
  it('renders no cells or endpoint labels when history is empty', () => {
    render(
      <TooltipProvider>
        <UptimeBar history={[]} />
      </TooltipProvider>
    );

    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryByText('Today')).toBeNull();
    expect(screen.queryByText(/day ago/)).toBeNull();
  });

  it('uses the oldest datapoint date for the start label', () => {
    render(
      <TooltipProvider>
        <UptimeBar
          history={[
            { date: '2026-03-03', status: 'operational' },
            { date: '2026-03-04', status: 'operational' },
          ]}
        />
      </TooltipProvider>
    );

    expect(screen.getByText(formatUptimeDate('2026-03-03'))).toBeTruthy();
    expect(screen.queryByText('1 day ago')).toBeNull();
  });

  it('labels a one-day history as today', () => {
    render(
      <TooltipProvider>
        <UptimeBar history={[{ date: isoDateDaysAgo(0), status: 'operational' }]} />
      </TooltipProvider>
    );

    expect(screen.getAllByText('Today')).toHaveLength(2);
  });

  it('uses the actual oldest date for sparse history', () => {
    render(
      <TooltipProvider>
        <UptimeBar
          history={[
            { date: '2026-03-01', status: 'operational' },
            { date: '2026-03-04', status: 'operational' },
          ]}
        />
      </TooltipProvider>
    );

    expect(screen.getByText(formatUptimeDate('2026-03-01'))).toBeTruthy();
    expect(screen.queryByText('1 day ago')).toBeNull();
  });

  it('shows Today when the most recent datapoint is from today', () => {
    render(
      <TooltipProvider>
        <UptimeBar
          history={[
            { date: isoDateDaysAgo(1), status: 'operational' },
            { date: isoDateDaysAgo(0), status: 'operational' },
          ]}
        />
      </TooltipProvider>
    );

    expect(screen.getByText('Today')).toBeTruthy();
  });

  it('shows a concrete date when the most recent datapoint is not today', () => {
    const yesterday = isoDateDaysAgo(1);

    render(
      <TooltipProvider>
        <UptimeBar
          history={[
            { date: isoDateDaysAgo(2), status: 'operational' },
            { date: yesterday, status: 'operational' },
          ]}
        />
      </TooltipProvider>
    );

    expect(screen.queryByText('Today')).toBeNull();
    expect(screen.getByText(formatUptimeDate(yesterday))).toBeTruthy();
  });

  it('labels invalid latest datapoints with a fallback', () => {
    render(
      <TooltipProvider>
        <UptimeBar history={[{ date: 'not-a-date', status: 'degraded' }]} />
      </TooltipProvider>
    );

    expect(screen.getByText('Latest')).toBeTruthy();
  });

  it('uses one tab stop and supports arrow, Home, and End navigation', async () => {
    render(
      <TooltipProvider delayDuration={60_000}>
        <UptimeBar
          history={[
            { date: '2026-03-02', status: 'operational' },
            { date: '2026-03-03', status: 'degraded', message: 'API latency elevated' },
            { date: '2026-03-04', status: 'operational' },
          ]}
        />
      </TooltipProvider>
    );

    const cells = screen.getAllByRole('button');
    const [firstCell, secondCell, thirdCell] = cells as [HTMLElement, HTMLElement, HTMLElement];
    expect(
      screen.getByRole('group', {
        name: 'Uptime: 3-day history. Use left and right arrow keys to review days.',
      })
    ).toBeInTheDocument();
    expect(cells.map((cell) => cell.getAttribute('tabindex'))).toEqual(['-1', '-1', '0']);
    expect(
      screen.getByRole('button', {
        name: '2026-03-03: Degraded Performance. API latency elevated',
      })
    ).toBe(secondCell);

    await act(async () => {
      fireEvent.keyDown(thirdCell, { key: 'ArrowLeft' });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.activeElement).toBe(secondCell);
    expect(cells.map((cell) => cell.getAttribute('tabindex'))).toEqual(['-1', '0', '-1']);

    await act(async () => {
      fireEvent.keyDown(secondCell, { key: 'Home' });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.activeElement).toBe(firstCell);

    await act(async () => {
      fireEvent.keyDown(firstCell, { key: 'ArrowRight' });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.activeElement).toBe(secondCell);

    await act(async () => {
      fireEvent.keyDown(secondCell, { key: 'End' });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.activeElement).toBe(thirdCell);
  });

  it('does not emit duplicate key warnings when dates repeat', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <TooltipProvider>
        <UptimeBar
          history={[
            { date: '2026-03-04', status: 'operational' },
            { date: '2026-03-04', status: 'degraded' },
          ]}
        />
      </TooltipProvider>
    );

    const errorText = errorSpy.mock.calls.flat().join('\n');
    expect(errorText.includes('Encountered two children with the same key')).toBe(false);
    errorSpy.mockRestore();
  });
});
