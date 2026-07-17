import { describe, expect, it } from 'bun:test';

import { collectLivePlanItems } from './DesktopPlanPanel';

describe('collectLivePlanItems', () => {
  it('uses the newest structured plan and normalizes todo statuses', () => {
    expect(
      collectLivePlanItems([
        { plan: ['old step'] },
        {
          todos: [
            { text: 'Inspect code', status: 'completed' },
            { step: 'Implement fix', status: 'in_progress' },
            { content: 'Verify behavior', status: 'pending' },
          ],
        },
      ])
    ).toEqual([
      { label: 'Inspect code', status: 'completed' },
      { label: 'Implement fix', status: 'in_progress' },
      { label: 'Verify behavior', status: 'pending' },
    ]);
  });

  it('supports markdown-like string plans', () => {
    expect(collectLivePlanItems([{ plan: '- Map code\n2. Make changes' }])).toEqual([
      { label: 'Map code', status: 'pending' },
      { label: 'Make changes', status: 'pending' },
    ]);
  });
});
