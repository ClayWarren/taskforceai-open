import { describe, expect, it } from 'bun:test';

import { AGENT_ROLES, getAgentRoleSlots } from './roles';

describe('getAgentRoleSlots', () => {
  it('matches visible role slots to the selected agent count', () => {
    expect(getAgentRoleSlots(2).map((role) => role.id)).toEqual(['Researcher', 'Analyst']);
  });

  it('falls back to the named role set and clamps unsupported counts', () => {
    expect(getAgentRoleSlots(undefined)).toEqual(AGENT_ROLES);
    expect(getAgentRoleSlots(0).map((role) => role.id)).toEqual(['Researcher']);
    expect(getAgentRoleSlots(8)).toEqual(AGENT_ROLES);
  });
});
