import { IMAGE_GENERATION_MODEL_ID, VIDEO_GENERATION_MODEL_ID } from './routing';

const TEXT_ATTACHMENT_ACCEPT = ['text/*', 'application/json', 'application/xml'] as const;

const IMAGE_ATTACHMENT_ACCEPT = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;

const AUDIO_ATTACHMENT_ACCEPT = [
  'audio/wav',
  'audio/mpeg',
  'audio/mp3',
  'audio/webm',
  'audio/ogg',
] as const;

const VIDEO_ATTACHMENT_ACCEPT = ['video/mp4', 'video/webm'] as const;

const OFFICE_ATTACHMENT_ACCEPT = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
] as const;

export const DEFAULT_PROMPT_ATTACHMENT_ACCEPT = [
  ...TEXT_ATTACHMENT_ACCEPT,
  ...IMAGE_ATTACHMENT_ACCEPT,
  ...AUDIO_ATTACHMENT_ACCEPT,
].join(',');

export const OPENAI_PROMPT_ATTACHMENT_ACCEPT = [
  DEFAULT_PROMPT_ATTACHMENT_ACCEPT,
  ...OFFICE_ATTACHMENT_ACCEPT,
].join(',');

export const GEMINI_PROMPT_ATTACHMENT_ACCEPT = [
  DEFAULT_PROMPT_ATTACHMENT_ACCEPT,
  ...VIDEO_ATTACHMENT_ACCEPT,
  ...OFFICE_ATTACHMENT_ACCEPT,
].join(',');

export const VIDEO_GENERATION_PROMPT_ATTACHMENT_ACCEPT = [
  DEFAULT_PROMPT_ATTACHMENT_ACCEPT,
  ...VIDEO_ATTACHMENT_ACCEPT,
].join(',');

export interface PromptSelectableModelOption {
  id: string;
}

export const isGeminiModelId = (modelId?: string | null): boolean =>
  Boolean(modelId?.toLowerCase().includes('gemini'));

export const isVideoGenerationModelId = (modelId?: string | null): boolean =>
  modelId?.toLowerCase() === VIDEO_GENERATION_MODEL_ID;

export const isOpenAIModelId = (modelId?: string | null): boolean => {
  const normalizedModelId = modelId?.toLowerCase();
  if (!normalizedModelId) {
    return false;
  }

  return (
    normalizedModelId.includes('gpt') ||
    normalizedModelId.includes('o1') ||
    normalizedModelId.includes('o3')
  );
};

export const buildPromptAttachmentAccept = (modelId?: string | null): string => {
  if (isVideoGenerationModelId(modelId)) {
    return VIDEO_GENERATION_PROMPT_ATTACHMENT_ACCEPT;
  }

  if (isGeminiModelId(modelId)) {
    return GEMINI_PROMPT_ATTACHMENT_ACCEPT;
  }

  if (isOpenAIModelId(modelId)) {
    return OPENAI_PROMPT_ATTACHMENT_ACCEPT;
  }

  return DEFAULT_PROMPT_ATTACHMENT_ACCEPT;
};

export const filterPromptSelectableModelOptions = <T extends PromptSelectableModelOption>(
  modelOptions: readonly T[]
): T[] =>
  modelOptions.filter(
    (option) => option.id !== IMAGE_GENERATION_MODEL_ID && option.id !== VIDEO_GENERATION_MODEL_ID
  );
