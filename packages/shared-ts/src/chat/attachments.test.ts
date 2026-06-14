import { describe, expect, it } from 'bun:test';

import {
  buildPromptAttachmentAccept,
  filterPromptSelectableModelOptions,
  isGeminiModelId,
  isOpenAIModelId,
  isVideoGenerationModelId,
} from './attachments';
import { IMAGE_GENERATION_MODEL_ID, VIDEO_GENERATION_MODEL_ID } from './routing';

describe('chat/attachments', () => {
  it('detects model families that support richer attachment types', () => {
    expect(isGeminiModelId('google/gemini-2.5-pro')).toBe(true);
    expect(isGeminiModelId('gpt-5')).toBe(false);
    expect(isOpenAIModelId('gpt-5')).toBe(true);
    expect(isOpenAIModelId('o3')).toBe(true);
    expect(isOpenAIModelId('anthropic/claude-sonnet-4.5')).toBe(false);
    expect(isVideoGenerationModelId(VIDEO_GENERATION_MODEL_ID)).toBe(true);
  });

  it('builds model-specific attachment accept strings', () => {
    expect(buildPromptAttachmentAccept('google/gemini-2.5-pro')).toContain('video/mp4');
    expect(buildPromptAttachmentAccept(VIDEO_GENERATION_MODEL_ID)).toContain('video/mp4');
    expect(buildPromptAttachmentAccept('google/gemini-2.5-pro')).toContain('application/pdf');
    expect(buildPromptAttachmentAccept(VIDEO_GENERATION_MODEL_ID)).not.toContain('application/pdf');
    expect(buildPromptAttachmentAccept('gpt-5')).not.toContain('video/mp4');
    expect(buildPromptAttachmentAccept('gpt-5')).toContain('application/pdf');
    expect(buildPromptAttachmentAccept('anthropic/claude-sonnet-4.5')).not.toContain(
      'application/pdf'
    );
  });

  it('keeps generation-only models out of manual model selection', () => {
    const options = [
      { id: 'gpt-5', label: 'GPT-5' },
      { id: IMAGE_GENERATION_MODEL_ID, label: 'Image model' },
      { id: VIDEO_GENERATION_MODEL_ID, label: 'Video model' },
    ];

    expect(filterPromptSelectableModelOptions(options)).toEqual([{ id: 'gpt-5', label: 'GPT-5' }]);
  });
});
