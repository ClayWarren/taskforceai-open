export interface AgentRole {
  id: string;
  label: string;
  description: string;
}

export const AGENT_ROLES: AgentRole[] = [
  { id: 'Researcher', label: 'Researcher', description: 'Web search & fact gathering' },
  { id: 'Analyst', label: 'Analyst', description: 'Data analysis & logic' },
  { id: 'Skeptic', label: 'Skeptic', description: 'Critique & risk assessment' },
  { id: 'Pragmatist', label: 'Pragmatist', description: 'Practical application' },
];

export const getAgentRoleSlots = (agentCount: number | null | undefined): AgentRole[] => {
  const requestedCount =
    typeof agentCount === 'number' && Number.isFinite(agentCount)
      ? Math.trunc(agentCount)
      : AGENT_ROLES.length;
  const visibleCount = Math.max(1, Math.min(requestedCount, AGENT_ROLES.length));

  return AGENT_ROLES.slice(0, visibleCount);
};
