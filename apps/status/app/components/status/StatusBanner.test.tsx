import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'bun:test';

import { StatusBanner } from './StatusBanner';
import type { ServiceStatus } from '@taskforceai/contracts/api/status';

const STATUS_CASES: Array<{
  status: ServiceStatus;
  label: string;
  textClass: string;
}> = [
  { status: 'operational', label: 'All Systems Operational', textClass: 'text-green-700' },
  { status: 'degraded', label: 'Partial System Outage', textClass: 'text-yellow-700' },
  { status: 'outage', label: 'Major System Outage', textClass: 'text-red-700' },
  { status: 'maintenance', label: 'Scheduled Maintenance', textClass: 'text-blue-700' },
];

describe('StatusBanner', () => {
  it.each(STATUS_CASES)(
    'renders the $status status label and color',
    ({ status, label, textClass }) => {
      render(<StatusBanner status={status} />);

      const labelElement = screen.getByText(label);
      expect(labelElement).toBeTruthy();
      expect(labelElement.className).toContain(textClass);
    }
  );
});
