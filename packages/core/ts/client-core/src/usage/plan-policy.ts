export type PublicPlan = 'free' | 'pro' | 'super';

export interface TaskAllowance {
  limit: number;
  window: 'week' | 'hour';
  label: string;
}

export const PLAN_TASK_ALLOWANCES: Record<PublicPlan, TaskAllowance> = {
  free: { limit: 1, window: 'week', label: '1 task credit per week' },
  pro: { limit: 2, window: 'hour', label: '2 task credits per hour' },
  super: { limit: 20, window: 'hour', label: '20 task credits per hour' },
};

export const normalizePublicPlan = (plan?: string | null): PublicPlan => {
  const normalized = plan?.trim().toLowerCase();
  if (normalized === 'pro' || normalized === 'super') return normalized;
  return 'free';
};

export const taskAllowanceForPlan = (plan?: string | null): TaskAllowance =>
  PLAN_TASK_ALLOWANCES[normalizePublicPlan(plan)];
