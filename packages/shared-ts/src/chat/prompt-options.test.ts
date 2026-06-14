import { describe, expect, it } from 'bun:test';

import {
  buildPromptAgentCountOptions,
  buildPromptModeBadges,
  buildPromptModeBadgeDescriptors,
  getMaxPromptAgentCount,
  parsePromptBudgetInput,
  PROMPT_MODE_DEFINITIONS,
} from './prompt-options';

describe('chat/prompt-options', () => {
  it('defines prompt mode labels and descriptions', () => {
    expect(PROMPT_MODE_DEFINITIONS.quickMode).toEqual({
      key: 'quickMode',
      label: 'Direct Chat',
      description: 'Standard single-assistant responses',
    });
    expect(PROMPT_MODE_DEFINITIONS.computerUse.label).toBe('Computer Use');
    expect(PROMPT_MODE_DEFINITIONS.autonomous.description).toBe('Self-directed task execution');
  });

  it('builds agent count options by plan', () => {
    expect(getMaxPromptAgentCount(null)).toBe(4);
    expect(buildPromptAgentCountOptions(null)).toEqual([1, 2, 4]);
    expect(getMaxPromptAgentCount('Super')).toBe(16);
    expect(buildPromptAgentCountOptions('super')).toEqual([1, 2, 4, 6, 8, 10, 12, 14, 16]);
  });

  it('parses optional budget input', () => {
    expect(parsePromptBudgetInput('')).toBeUndefined();
    expect(parsePromptBudgetInput('12.50')).toBe(12.5);
    expect(parsePromptBudgetInput('-1')).toBeNull();
    expect(parsePromptBudgetInput('not-a-number')).toBeNull();
  });

  it('builds shared prompt mode badge descriptors', () => {
    expect(
      buildPromptModeBadgeDescriptors({
        quickModeEnabled: false,
        autonomousModeEnabled: true,
        computerUseEnabled: true,
        computerUseSessionMode: 'logged_in',
        roleModels: { critic: 'gpt-5' },
        includeLoggedInServices: true,
      }).map(({ key, enabled }) => [key, enabled])
    ).toEqual([
      ['agentTeams', true],
      ['customOrchestration', true],
      ['autonomous', true],
      ['computerUse', true],
      ['computerAuthMode', true],
    ]);
  });

  it('combines prompt mode descriptors with platform badge metadata', () => {
    expect(
      buildPromptModeBadges(
        {
          quickModeEnabled: false,
          autonomousModeEnabled: false,
          computerUseEnabled: false,
          computerUseSessionMode: 'logged_out',
          roleModels: {},
          isAutonomyAllowed: false,
          isComputerUseAllowed: false,
          includeLoggedInServices: false,
        },
        {
          agentTeams: { iconName: 'Users' },
          customOrchestration: { iconName: 'SlidersHorizontal' },
          autonomous: { iconName: 'Bot' },
          quickMode: { iconName: 'Zap' },
          computerUse: { iconName: 'Monitor' },
          computerAuthMode: { iconName: 'KeyRound' },
        }
      )
    ).toEqual([
      {
        key: 'agentTeams',
        label: 'Agent Teams',
        enabled: true,
        iconName: 'Users',
      },
      {
        key: 'customOrchestration',
        label: 'Agent Team Config',
        enabled: false,
        iconName: 'SlidersHorizontal',
      },
    ]);
  });
});
