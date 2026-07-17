import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'bun:test';

import '../../../../../tests/setup/dom';
import { DesktopPlanPanel } from './DesktopPlanPanel';

describe('DesktopPlanPanel', () => {
  afterEach(() => cleanup());

  it('renders live plan progress and collapses the item list', () => {
    render(
      <DesktopPlanPanel
        agentStatuses={[
          {
            plan: [
              { title: 'Inspect', status: 'finished' },
              { text: 'Implement', status: 'running' },
              { content: 'Verify', status: 'pending' },
            ],
          },
        ]}
      />
    );

    expect(screen.getByRole('complementary', { name: 'Live task plan' })).toBeTruthy();
    expect(screen.getByText('1 of 3 complete')).toBeTruthy();
    expect(screen.getByText('Inspect').className).toContain('line-through');
    expect(screen.getByText('Implement')).toBeTruthy();
    expect(screen.getByText('Verify')).toBeTruthy();

    fireEvent.click(screen.getByRole('button'));
    expect(screen.queryByText('Inspect')).toBeNull();
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Inspect')).toBeTruthy();
  });

  it('renders nothing when no status contains a usable plan', () => {
    const { container } = render(<DesktopPlanPanel agentStatuses={[null, { plan: [42, {}] }]} />);
    expect(container.firstChild).toBeNull();
  });
});
