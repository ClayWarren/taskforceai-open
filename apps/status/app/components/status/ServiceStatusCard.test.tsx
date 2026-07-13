import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'bun:test';

import { TooltipProvider } from '@taskforceai/ui-kit/tooltip';
import { ServiceStatusCard } from './ServiceStatusCard';
import type { Service, ServiceStatus } from '@taskforceai/contracts/api/status';

const STATUS_CASES: Array<{
  status: ServiceStatus;
  label: string;
  textClass: string;
}> = [
  { status: 'operational', label: 'Operational', textClass: 'text-green-700' },
  { status: 'degraded', label: 'Degraded', textClass: 'text-yellow-700' },
  { status: 'outage', label: 'Outage', textClass: 'text-red-700' },
  { status: 'maintenance', label: 'Maintenance', textClass: 'text-blue-700' },
];

function serviceFor(status: ServiceStatus): Service {
  return {
    id: `${status}-service`,
    name: `${status} service`,
    status,
    uptimePercent: 98.75,
    uptimeHistory: [{ date: '2026-03-01', status }],
  };
}

describe('ServiceStatusCard', () => {
  it.each(STATUS_CASES)(
    'renders the $status badge label and color',
    ({ status, label, textClass }) => {
      render(
        <TooltipProvider>
          <ServiceStatusCard service={serviceFor(status)} />
        </TooltipProvider>
      );

      const badge = screen.getByText(label, { selector: 'span.rounded-full' });
      expect(screen.getByText(`${status} service`)).toBeTruthy();
      expect(badge.className).toContain(textClass);
      expect(screen.getByText('98.75% uptime')).toBeTruthy();
    }
  );
});
