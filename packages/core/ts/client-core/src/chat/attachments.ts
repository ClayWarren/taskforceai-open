import { IMAGE_GENERATION_MODEL_ID, VIDEO_GENERATION_MODEL_ID } from './routing';
import {
  SUPPORTED_AUDIO_ATTACHMENT_MIME_TYPES,
  SUPPORTED_DOCUMENT_ATTACHMENT_MIME_TYPES,
  SUPPORTED_IMAGE_ATTACHMENT_MIME_TYPES,
  SUPPORTED_VIDEO_ATTACHMENT_MIME_TYPES,
} from '../validation';

const TEXT_ATTACHMENT_MIME_TYPES = new Set<string>([
  'text/plain',
  'text/markdown',
  'application/json',
]);

const TEXT_ATTACHMENT_ACCEPT = SUPPORTED_DOCUMENT_ATTACHMENT_MIME_TYPES.filter((mime) =>
  TEXT_ATTACHMENT_MIME_TYPES.has(mime)
);

const OFFICE_ATTACHMENT_ACCEPT = SUPPORTED_DOCUMENT_ATTACHMENT_MIME_TYPES.filter(
  (mime) => !TEXT_ATTACHMENT_MIME_TYPES.has(mime)
);

export const DEFAULT_PROMPT_ATTACHMENT_ACCEPT = [
  ...TEXT_ATTACHMENT_ACCEPT,
  ...SUPPORTED_IMAGE_ATTACHMENT_MIME_TYPES,
  ...SUPPORTED_AUDIO_ATTACHMENT_MIME_TYPES,
].join(',');

export const OPENAI_PROMPT_ATTACHMENT_ACCEPT = [
  DEFAULT_PROMPT_ATTACHMENT_ACCEPT,
  ...OFFICE_ATTACHMENT_ACCEPT,
].join(',');

export const GEMINI_PROMPT_ATTACHMENT_ACCEPT = [
  DEFAULT_PROMPT_ATTACHMENT_ACCEPT,
  ...SUPPORTED_VIDEO_ATTACHMENT_MIME_TYPES,
  ...OFFICE_ATTACHMENT_ACCEPT,
].join(',');

export const VIDEO_GENERATION_PROMPT_ATTACHMENT_ACCEPT = [
  ...SUPPORTED_IMAGE_ATTACHMENT_MIME_TYPES,
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

  const [namespace, modelName] = normalizedModelId.includes('/')
    ? normalizedModelId.split('/', 2)
    : [undefined, normalizedModelId];
  if (namespace && namespace !== 'openai') {
    return false;
  }

  return /^(?:gpt(?:[-_.\d]|$)|o(?:1|3)(?:[-_.]|$))/.test(modelName ?? '');
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
