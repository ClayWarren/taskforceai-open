export const PROFILE_PLANS = ['free', 'pro', 'super'] as const;
export type ProfilePlan = (typeof PROFILE_PLANS)[number];
export type PaidProfilePlan = Exclude<ProfilePlan, 'free'>;

export const PAID_PROFILE_PLANS = ['pro', 'super'] as const satisfies readonly PaidProfilePlan[];

export const PLAN_AGENT_LIMITS = {
  free: 2,
  pro: 4,
  super: 16,
} as const satisfies Record<ProfilePlan, number>;

export const normalizeProfilePlan = (plan: string | null | undefined): ProfilePlan => {
  const normalized = plan?.trim().toLowerCase();
  return normalized === 'pro' || normalized === 'super' ? normalized : 'free';
};

export const getPlanAgentLimit = (plan: string | null | undefined): number =>
  PLAN_AGENT_LIMITS[normalizeProfilePlan(plan)];
