import { describe, expect, it } from 'bun:test';

import {
  buildPromptAgentCountOptions,
  getMaxPromptAgentCount,
  parsePromptBudgetInput,
} from './prompt-options';

describe('chat/prompt-options', () => {
  it('builds agent count options by plan', () => {
    expect(getMaxPromptAgentCount(null)).toBe(2);
    expect(buildPromptAgentCountOptions(null)).toEqual([1, 2]);
    expect(getMaxPromptAgentCount('pro')).toBe(4);
    expect(buildPromptAgentCountOptions('pro')).toEqual([1, 2, 4]);
    expect(getMaxPromptAgentCount('Super')).toBe(16);
    expect(buildPromptAgentCountOptions('super')).toEqual([1, 2, 4, 6, 8, 10, 12, 14, 16]);
  });

  it('parses optional budget input', () => {
    expect(parsePromptBudgetInput('')).toBeUndefined();
    expect(parsePromptBudgetInput('12.50')).toBe(12.5);
    expect(parsePromptBudgetInput('-1')).toBeNull();
    expect(parsePromptBudgetInput('not-a-number')).toBeNull();
  });
});
