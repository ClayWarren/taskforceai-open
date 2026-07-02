import { definedProps } from '../utils/object';

export const IMAGE_GENERATION_MODEL_ID = 'google/gemini-2.5-flash-image';
export const VIDEO_GENERATION_MODEL_ID = 'xai/grok-imagine-video';

export const IMAGE_SUBJECT_PATTERN =
  /\b(images?|pictures?|photos?|illustrations?|artwork|logos?|avatars?|icons?|wallpapers?|posters?|stickers?|memes?)\b/i;
export const VIDEO_SUBJECT_PATTERN =
  /\b(videos?|clips?|shorts|reels?|animations?|movies?|trailers?|storyboards?)\b/i;
export const IMAGE_GENERATION_VERB_PATTERN =
  /\b(generate|create|make|draw|design|illustrate|render|produce|craft)\b/i;
export const VIDEO_GENERATION_VERB_PATTERN =
  /\b(generate|create|make|animate|render|produce|edit|transform|turn|convert)\b/i;
export const IMAGE_EDIT_VERB_PATTERN =
  /\b(edit|modify|transform|restyle|retouch|upscale|enhance|recolor|remove background)\b/i;
export const VIDEO_EDIT_VERB_PATTERN = /\b(animate|motion|lip[- ]?sync|add audio|voiceover)\b/i;

export interface AutoRouteResult {
  modelId: string | null;
  quickModeEnabled?: boolean;
  computerUseEnabled?: boolean;
}

export interface PromptRoutingMetadata {
  modelId?: string;
  quickModeEnabled?: boolean;
  computerUseEnabled?: boolean;
}

export const shouldAutoRouteToImageModel = ({
  prompt,
  hasAttachments,
}: {
  prompt: string;
  hasAttachments: boolean;
}): boolean => {
  const normalizedPrompt = prompt.toLowerCase();

  const isImageGenerationRequest =
    IMAGE_SUBJECT_PATTERN.test(normalizedPrompt) &&
    IMAGE_GENERATION_VERB_PATTERN.test(normalizedPrompt);
  if (isImageGenerationRequest) {
    return true;
  }

  return hasAttachments && IMAGE_EDIT_VERB_PATTERN.test(normalizedPrompt);
};

export const shouldAutoRouteToVideoModel = ({
  prompt,
  hasAttachments,
}: {
  prompt: string;
  hasAttachments: boolean;
}): boolean => {
  const normalizedPrompt = prompt.toLowerCase();

  const isVideoGenerationRequest =
    VIDEO_SUBJECT_PATTERN.test(normalizedPrompt) &&
    VIDEO_GENERATION_VERB_PATTERN.test(normalizedPrompt);
  if (isVideoGenerationRequest) {
    return true;
  }

  return hasAttachments && VIDEO_EDIT_VERB_PATTERN.test(normalizedPrompt);
};

export const resolveRoutingOverrides = ({
  prompt,
  hasAttachments,
  currentModelId,
  currentQuickMode,
  currentComputerUse,
}: {
  prompt: string;
  hasAttachments: boolean;
  currentModelId?: string | null;
  currentQuickMode?: boolean;
  currentComputerUse?: boolean;
}): AutoRouteResult => {
  const autoRouteToVideoModel = shouldAutoRouteToVideoModel({
    prompt,
    hasAttachments,
  });

  if (autoRouteToVideoModel) {
    return {
      modelId: VIDEO_GENERATION_MODEL_ID,
      quickModeEnabled: true,
      computerUseEnabled: false,
    };
  }

  const autoRouteToImageModel = shouldAutoRouteToImageModel({
    prompt,
    hasAttachments,
  });

  if (autoRouteToImageModel) {
    return {
      modelId: IMAGE_GENERATION_MODEL_ID,
      quickModeEnabled: true,
      computerUseEnabled: false,
    };
  }

  return {
    modelId: currentModelId ?? null,
    ...definedProps({
      quickModeEnabled: currentQuickMode,
      computerUseEnabled: currentComputerUse,
    }),
  };
};

export const buildPromptRoutingMetadata = ({
  prompt,
  hasAttachments,
  currentModelId,
  currentQuickMode,
  currentComputerUse,
}: {
  prompt: string;
  hasAttachments: boolean;
  currentModelId?: string | null;
  currentQuickMode?: boolean;
  currentComputerUse?: boolean;
}): PromptRoutingMetadata => {
  const overrides = resolveRoutingOverrides({
    prompt,
    hasAttachments,
    ...definedProps({
      currentModelId,
      currentQuickMode,
      currentComputerUse,
    }),
  });

  return {
    ...definedProps({
      modelId: overrides.modelId ?? undefined,
      quickModeEnabled: overrides.quickModeEnabled,
      computerUseEnabled: overrides.computerUseEnabled,
    }),
  };
};
