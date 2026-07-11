import { describe, expect, it, vi } from 'bun:test';

import {
  applyStoredOrchestrationConfig,
  buildOrchestrationConfig,
  clampOrchestrationAgentCount,
} from './orchestrationConfig';

describe('orchestration config helpers', () => {
  it('builds current orchestration config snapshots', () => {
    expect(
      buildOrchestrationConfig({
        roleModels: { planner: 'gpt-5' },
        budget: 25,
        agentCount: 6,
      })
    ).toEqual({
      roleModels: { planner: 'gpt-5' },
      budget: 25,
      agentCount: 6,
    });
  });

  it('clamps orchestration agent count', () => {
    expect(clampOrchestrationAgentCount(-1)).toBe(1);
    expect(clampOrchestrationAgentCount(4)).toBe(4);
    expect(clampOrchestrationAgentCount(40)).toBe(20);
  });

  it('applies stored config through bulk setters', () => {
    const setRoleModels = vi.fn();
    const setBudget = vi.fn();
    const setAgentCount = vi.fn();

    applyStoredOrchestrationConfig(
      { roleModels: { planner: 'gpt-5' }, budget: 10, agentCount: 30 },
      { setRoleModels, setBudget, setAgentCount }
    );

    expect(setRoleModels).toHaveBeenCalledWith({ planner: 'gpt-5' });
    expect(setBudget).toHaveBeenCalledWith(10);
    expect(setAgentCount).toHaveBeenCalledWith(20);
  });

  it('applies stored role models one role at a time and reports failures', () => {
    const error = new Error('bad role');
    const setRoleModel = vi.fn((role: string) => {
      if (role === 'planner') {
        throw error;
      }
    });
    const onRoleModelError = vi.fn();

    applyStoredOrchestrationConfig(
      { roleModels: { planner: 'gpt-5', coder: 'gpt-5-mini' }, agentCount: 2 },
      { setRoleModel, onRoleModelError }
    );

    expect(setRoleModel).toHaveBeenCalledWith('planner', 'gpt-5');
    expect(setRoleModel).toHaveBeenCalledWith('coder', 'gpt-5-mini');
    expect(onRoleModelError).toHaveBeenCalledWith(error, {
      role: 'planner',
      modelId: 'gpt-5',
    });
  });
});
