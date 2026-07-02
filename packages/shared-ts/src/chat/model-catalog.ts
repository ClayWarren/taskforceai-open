export interface PublicModelOptionSummary {
  id: string;
  label: string;
  badge: string;
  description?: string;
  usageMultiple?: number;
}

export interface PublicModelSelectorCatalog {
  enabled: boolean;
  options: PublicModelOptionSummary[];
  defaultModelId: string;
}

export const PUBLIC_MODEL_SELECTOR_CATALOG: PublicModelSelectorCatalog = {
  enabled: true,
  defaultModelId: 'zai/glm-5.2',
  options: [
    {
      id: 'zai/glm-5.2',
      label: 'Sentinel',
      badge: 'Default',
      description: 'Our flagship high-reasoning model, optimized for complex task planning.',
      usageMultiple: 1,
    },
    {
      id: 'xai/grok-4.3',
      label: 'Grok 4.3',
      badge: 'Pro',
      description: "xAI's latest heavy reasoning tier with extended planning depth.",
      usageMultiple: 2,
    },
    {
      id: 'google/gemini-3.1-pro-preview',
      label: 'Gemini 3.1 Pro',
      badge: 'Research',
      description: 'Full-strength Gemini tier geared toward difficult research prompts.',
      usageMultiple: 1,
    },
    {
      id: 'google/gemini-2.5-flash-image',
      label: 'Gemini Image',
      badge: 'Available',
      description: 'Native image generation powered by Gemini 2.5 Flash.',
      usageMultiple: 1,
    },
    {
      id: 'xai/grok-imagine-video',
      label: 'Grok Imagine Video',
      badge: 'Video',
      description:
        'AI Gateway video generation for text-to-video, image-to-video, and video editing.',
      usageMultiple: 4,
    },
    {
      id: 'openai/gpt-5.5',
      label: 'GPT 5.5',
      badge: 'Pro',
      description: 'OpenAI GPT-5.5 profile tuned for extended reasoning depth.',
      usageMultiple: 1,
    },
    {
      id: 'anthropic/claude-fable-5',
      label: 'Claude Fable 5',
      badge: 'Pro',
      description: "Anthropic's balance of reasoning strength and latency for fallback coverage.",
      usageMultiple: 2,
    },
  ],
};

const PUBLIC_MODEL_LABELS_BY_ID = new Map(
  PUBLIC_MODEL_SELECTOR_CATALOG.options.map((option) => [option.id.toLowerCase(), option.label])
);

export const getPublicModelLabel = (modelIdOrLabel?: string | null): string | undefined => {
  const value = modelIdOrLabel?.trim();
  if (!value) {
    return undefined;
  }
  return PUBLIC_MODEL_LABELS_BY_ID.get(value.toLowerCase()) ?? value;
};
