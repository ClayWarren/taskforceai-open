import { describe, expect, it } from 'bun:test';

import { PLAN_TASK_ALLOWANCES, taskAllowanceForPlan } from './plan-policy';

describe('plan task allowances', () => {
  it('matches the public pricing policy', () => {
    expect(PLAN_TASK_ALLOWANCES.free).toEqual({
      limit: 1,
      window: 'week',
      label: '1 task credit per week',
    });
    expect(PLAN_TASK_ALLOWANCES.pro).toEqual({
      limit: 2,
      window: 'hour',
      label: '2 task credits per hour',
    });
    expect(PLAN_TASK_ALLOWANCES.super).toEqual({
      limit: 20,
      window: 'hour',
      label: '20 task credits per hour',
    });
  });

  it('normalizes unknown plans to free', () => {
    expect(taskAllowanceForPlan(' PRO ')).toEqual(PLAN_TASK_ALLOWANCES.pro);
    expect(taskAllowanceForPlan('unknown')).toEqual(PLAN_TASK_ALLOWANCES.free);
  });
});
