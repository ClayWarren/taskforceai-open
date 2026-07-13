import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'bun:test';

import { formatIncidentDateUtc, IncidentHistory } from './IncidentHistory';
import type { Incident } from '@taskforceai/contracts/api/status';

describe('IncidentHistory', () => {
  it('renders the empty incident state', () => {
    render(<IncidentHistory incidents={[]} />);

    expect(screen.getByRole('heading', { name: 'Past Incidents' })).toBeInTheDocument();
    expect(screen.getByText('No incidents reported in the last 14 days.')).toBeInTheDocument();
  });

  it('groups incidents by UTC day, sorts newest first, and renders status badges', () => {
    const incidents = [
      {
        id: 'maintenance-1',
        title: 'Scheduled maintenance',
        status: 'maintenance',
        affectedServices: ['api'],
        createdAt: '2026-03-01T23:30:00-05:00',
        updates: [
          {
            id: 'maintenance-update',
            status: 'maintenance',
            message: 'Maintenance window completed',
            createdAt: '2026-03-02T04:45:00Z',
          },
        ],
      },
      {
        id: 'outage-1',
        title: 'API outage',
        status: 'outage',
        affectedServices: ['api'],
        createdAt: '2026-03-02T01:00:00Z',
        updates: [
          {
            id: 'outage-update',
            status: 'outage',
            message: 'Investigating elevated errors',
            createdAt: '2026-03-02T01:15:00Z',
          },
        ],
      },
      {
        id: 'degraded-1',
        title: 'Slow responses',
        status: 'degraded',
        affectedServices: ['web'],
        createdAt: '2026-03-01',
        updates: [
          {
            id: 'degraded-update',
            status: 'degraded',
            message: 'Latency returned to baseline',
            createdAt: '2026-03-01T18:05:00',
          },
        ],
      },
      {
        id: 'operational-1',
        title: 'Recovered',
        status: 'operational',
        affectedServices: ['docs'],
        createdAt: '2026-02-28T12:00:00Z',
        updates: [
          {
            id: 'operational-update',
            status: 'operational',
            message: 'Service remained healthy',
            createdAt: '2026-02-28T12:30:00Z',
          },
        ],
      },
    ] satisfies Incident[];

    render(<IncidentHistory incidents={incidents} />);

    const headings = screen
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent);
    expect(headings).toEqual(['March 2, 2026', 'March 1, 2026', 'February 28, 2026']);

    expect(screen.getByText('Scheduled maintenance')).toBeInTheDocument();
    expect(screen.getByText('API outage')).toBeInTheDocument();
    expect(screen.getByText('Slow responses')).toBeInTheDocument();
    expect(screen.getByText('Recovered')).toBeInTheDocument();

    expect(screen.getByText('MAINTENANCE').className).toContain('bg-blue-500/10');
    expect(screen.getByText('OUTAGE').className).toContain('bg-red-500/10');
    expect(screen.getByText('DEGRADED').className).toContain('bg-yellow-500/10');
    expect(screen.getByText('OPERATIONAL').className).toContain('bg-green-500/10');

    expect(screen.getByText('Maintenance window completed')).toBeInTheDocument();
    expect(screen.getByText('Mar 2, 04:45 UTC')).toBeInTheDocument();
    expect(screen.getByText('Mar 1, 18:05 UTC')).toBeInTheDocument();
  });

  it('places invalid incident dates last and uses the fallback status color', () => {
    const incidents = [
      {
        id: 'valid-incident',
        title: 'Valid incident',
        status: 'operational',
        affectedServices: [],
        createdAt: '2026-04-01',
        updates: [],
      },
      {
        id: 'invalid-incident',
        title: 'Unknown incident state',
        status: 'unknown',
        affectedServices: [],
        createdAt: 'not-a-date',
        updates: [
          {
            id: 'invalid-update',
            status: 'unknown',
            message: 'Update timestamp could not be parsed',
            createdAt: 'still-not-a-date',
          },
        ],
      },
    ] as Incident[];

    render(<IncidentHistory incidents={incidents} />);

    const headings = screen
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent);
    expect(headings).toEqual(['April 1, 2026', 'Invalid Date']);
    expect(screen.getByText('UNKNOWN').className).toContain('bg-gray-500/10');
    expect(screen.getByText('Invalid Date UTC')).toBeInTheDocument();
    expect(formatIncidentDateUtc('not-a-date', { year: 'numeric' })).toBe('Invalid Date');
  });
});
