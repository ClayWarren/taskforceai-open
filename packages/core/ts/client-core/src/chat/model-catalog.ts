export interface PublicModelOptionSummary {
  id: string;
  label: string;
  badge: string;
  description?: string;
  usageMultiple?: number;
  reasoningEffortLevels?: string[];
  defaultReasoningEffort?: string;
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
      id: 'xai/grok-4.5',
      label: 'Grok 4.5',
      badge: 'Pro',
      description: "xAI's latest heavy reasoning tier with extended planning depth.",
      usageMultiple: 1.5,
      reasoningEffortLevels: ['low', 'medium', 'high'],
      defaultReasoningEffort: 'high',
    },
    {
      id: 'meta/muse-spark-1.1',
      label: 'Muse Spark 1.1',
      badge: 'Pro',
      description: "Meta's agentic model for long-running tasks, tool use, and computer use.",
      usageMultiple: 1,
    },
    {
      id: 'google/gemini-3.1-pro-preview',
      label: 'Gemini 3.1 Pro',
      badge: 'Research',
      description: 'Full-strength Gemini tier geared toward difficult research prompts.',
      usageMultiple: 2,
      reasoningEffortLevels: ['low', 'medium', 'high'],
      defaultReasoningEffort: 'high',
    },
    {
      id: 'google/gemini-3.5-flash',
      label: 'Gemini 3.5 Flash',
      badge: 'Fast',
      description: 'Fast Gemini tier for everyday prompts, analysis, and tool-heavy workflows.',
      usageMultiple: 1.5,
      reasoningEffortLevels: ['minimal', 'low', 'medium', 'high'],
      defaultReasoningEffort: 'medium',
    },
    {
      id: 'google/gemini-3.1-flash-lite',
      label: 'Gemini 3.1 Flash Lite',
      badge: 'Fast',
      description: 'Lightweight Gemini tier optimized for low-latency, lower-cost tasks.',
      usageMultiple: 0.5,
      reasoningEffortLevels: ['minimal', 'low', 'medium', 'high'],
      defaultReasoningEffort: 'minimal',
    },
    {
      id: 'google/gemini-2.5-flash-image',
      label: 'Gemini Image',
      badge: 'Available',
      description: 'Native image generation powered by Gemini 2.5 Flash.',
      usageMultiple: 1,
    },
    {
      id: 'xai/grok-imagine-video-1.5',
      label: 'Grok Imagine Video',
      badge: 'Video',
      description:
        'AI Gateway image-to-video generation with synced audio powered by Grok Imagine Video 1.5.',
      usageMultiple: 4,
    },
    {
      id: 'openai/gpt-5.6-sol',
      label: 'GPT 5.6 Sol',
      badge: 'Research',
      description: "OpenAI's flagship GPT-5.6 model for the most demanding reasoning tasks.",
      usageMultiple: 5,
      reasoningEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
      defaultReasoningEffort: 'medium',
    },
    {
      id: 'openai/gpt-5.6-terra',
      label: 'GPT 5.6 Terra',
      badge: 'Pro',
      description: 'Balanced GPT-5.6 tier for strong everyday reasoning at lower cost.',
      usageMultiple: 2.5,
      reasoningEffortLevels: ['low', 'medium', 'high', 'xhigh'],
      defaultReasoningEffort: 'medium',
    },
    {
      id: 'openai/gpt-5.6-luna',
      label: 'GPT 5.6 Luna',
      badge: 'Fast',
      description: 'Fast, cost-efficient GPT-5.6 tier for responsive everyday work.',
      usageMultiple: 1,
      reasoningEffortLevels: ['low', 'medium', 'high', 'xhigh'],
      defaultReasoningEffort: 'medium',
    },
    {
      id: 'anthropic/claude-fable-5',
      label: 'Claude Fable 5',
      badge: 'Pro',
      description: "Anthropic's balance of reasoning strength and latency for fallback coverage.",
      usageMultiple: 9,
      reasoningEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
      defaultReasoningEffort: 'high',
    },
    {
      id: 'anthropic/claude-sonnet-5',
      label: 'Claude Sonnet 5',
      badge: 'Pro',
      description:
        'Anthropic Sonnet tier balanced for strong reasoning, coding, and responsiveness.',
      usageMultiple: 2,
      reasoningEffortLevels: ['low', 'medium', 'high', 'xhigh'],
      defaultReasoningEffort: 'high',
    },
    {
      id: 'anthropic/claude-opus-4.8',
      label: 'Claude Opus 4.8',
      badge: 'Research',
      description: 'Anthropic Opus tier for deeper reasoning and high-stakes synthesis.',
      usageMultiple: 4.5,
      reasoningEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
      defaultReasoningEffort: 'high',
    },
    {
      id: 'anthropic/claude-haiku-4.5',
      label: 'Claude Haiku 4.5',
      badge: 'Fast',
      description: 'Anthropic Haiku tier optimized for fast, lightweight assistant work.',
      usageMultiple: 1,
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
