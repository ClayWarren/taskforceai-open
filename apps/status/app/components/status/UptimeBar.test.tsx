import { render, screen } from '@testing-library/react';
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

    expect(screen.queryAllByRole('img')).toHaveLength(0);
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

  it('makes uptime cells keyboard focusable with tooltip message text', () => {
    render(
      <TooltipProvider>
        <UptimeBar
          history={[{ date: '2026-03-04', status: 'degraded', message: 'API latency elevated' }]}
        />
      </TooltipProvider>
    );

    const cell = screen.getByRole('img', {
      name: '2026-03-04: Degraded Performance. API latency elevated',
    });
    expect(cell.getAttribute('tabindex')).toBe('0');
    expect(cell.querySelector('[aria-hidden="true"]')?.textContent).toBe('API latency elevated');
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
