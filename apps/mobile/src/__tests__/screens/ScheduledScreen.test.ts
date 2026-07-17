import type { Agent } from '@taskforceai/contracts/contracts';

import { scheduledFilterForAgent } from '../../screens/ScheduledScreen';

const agent = (overrides: Partial<Agent> = {}): Agent => ({
  active_days: [0, 1, 2, 3, 4, 5, 6],
  active_end: '23:59',
  active_start: '00:00',
  autonomy_enabled: true,
  avatar: null,
  check_interval: 600,
  created_at: '2026-07-12T12:00:00',
  description: 'Prepare a daily brief',
  id: 'agent-1',
  last_run_at: null,
  model_id: null,
  name: 'Daily brief',
  next_run_at: '2026-07-12T12:10:00',
  status: 'IDLE',
  timezone: 'America/Chicago',
  updated_at: '2026-07-12T12:00:00',
  user_id: 1,
  ...overrides,
});

describe('scheduledFilterForAgent', () => {
  it('classifies enabled and disabled schedules', () => {
    expect(scheduledFilterForAgent(agent())).toBe('active');
    expect(scheduledFilterForAgent(agent({ autonomy_enabled: false }))).toBe('paused');
  });

  it('prioritizes completed status over enabled state', () => {
    expect(scheduledFilterForAgent(agent({ status: 'COMPLETED' }))).toBe('completed');
  });
});
