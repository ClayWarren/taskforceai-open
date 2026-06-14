import { describe, expect, it } from 'bun:test';
import { usePromptSubmission } from './usePromptSubmission';
import { useFileAttachments } from './useFileAttachments';
import { useVoiceControl } from './useVoiceControl';

describe('React Core Smoke Test', () => {
  it('should export hooks', () => {
    expect(usePromptSubmission).toBeDefined();
    expect(useFileAttachments).toBeDefined();
    expect(useVoiceControl).toBeDefined();
  });
});
