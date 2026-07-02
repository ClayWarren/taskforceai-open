import { describe, expect, it } from 'bun:test';

import {
  buildPromptRoutingMetadata,
  IMAGE_GENERATION_MODEL_ID,
  resolveRoutingOverrides,
  shouldAutoRouteToImageModel,
  shouldAutoRouteToVideoModel,
  VIDEO_GENERATION_MODEL_ID,
} from './routing';

describe('chat/routing', () => {
  describe('shouldAutoRouteToImageModel', () => {
    it('matches common singular and plural image-generation prompts', () => {
      expect(
        shouldAutoRouteToImageModel({
          prompt: 'Generate an image of a cat',
          hasAttachments: false,
        })
      ).toBe(true);

      expect(
        shouldAutoRouteToImageModel({
          prompt: 'Generate images of cats',
          hasAttachments: false,
        })
      ).toBe(true);

      expect(
        shouldAutoRouteToImageModel({
          prompt: 'Create photos of a city skyline',
          hasAttachments: false,
        })
      ).toBe(true);

      expect(
        shouldAutoRouteToImageModel({
          prompt: 'Please design a logo for the launch',
          hasAttachments: false,
        })
      ).toBe(true);

      expect(
        shouldAutoRouteToImageModel({
          prompt: 'CRAFT AN AVATAR WITH NEON LIGHTING',
          hasAttachments: false,
        })
      ).toBe(true);
    });

    it('routes image editing only when attachments are present', () => {
      expect(
        shouldAutoRouteToImageModel({
          prompt: 'Please edit and upscale this',
          hasAttachments: false,
        })
      ).toBe(false);

      expect(
        shouldAutoRouteToImageModel({
          prompt: 'Please edit and upscale this',
          hasAttachments: true,
        })
      ).toBe(true);

      expect(
        shouldAutoRouteToImageModel({
          prompt: 'Remove background from this product photo',
          hasAttachments: true,
        })
      ).toBe(true);
    });

    it('does not route when only an image subject or generation verb is present', () => {
      expect(
        shouldAutoRouteToImageModel({
          prompt: 'Analyze this image carefully',
          hasAttachments: false,
        })
      ).toBe(false);

      expect(
        shouldAutoRouteToImageModel({
          prompt: 'Create a release plan',
          hasAttachments: false,
        })
      ).toBe(false);
    });
  });

  describe('shouldAutoRouteToVideoModel', () => {
    it('matches common video-generation prompts', () => {
      expect(
        shouldAutoRouteToVideoModel({
          prompt: 'Generate a video of a product demo with synced audio',
          hasAttachments: false,
        })
      ).toBe(true);

      expect(
        shouldAutoRouteToVideoModel({
          prompt: 'Animate this storyboard into a short clip',
          hasAttachments: false,
        })
      ).toBe(true);
    });

    it('routes video editing only when attachments are present', () => {
      expect(
        shouldAutoRouteToVideoModel({
          prompt: 'Add motion and lip sync to this',
          hasAttachments: false,
        })
      ).toBe(false);

      expect(
        shouldAutoRouteToVideoModel({
          prompt: 'Add motion and lip sync to this',
          hasAttachments: true,
        })
      ).toBe(true);
    });

    it('does not treat short text instructions as video shorts', () => {
      expect(
        shouldAutoRouteToVideoModel({
          prompt: 'Create demo/notes.txt with two short lines',
          hasAttachments: false,
        })
      ).toBe(false);
    });
  });

  describe('resolveRoutingOverrides', () => {
    it('prioritizes video routing over image routing for video-generation prompts', () => {
      const result = resolveRoutingOverrides({
        prompt: 'Create a video from this image with camera motion',
        hasAttachments: true,
        currentModelId: 'openai/gpt-5',
        currentQuickMode: false,
        currentComputerUse: true,
      });

      expect(result).toEqual({
        modelId: VIDEO_GENERATION_MODEL_ID,
        quickModeEnabled: true,
        computerUseEnabled: false,
      });
    });

    it('enables quick mode and image model for image-generation prompts', () => {
      const result = resolveRoutingOverrides({
        prompt: 'Generate images of mountains',
        hasAttachments: false,
        currentModelId: 'openai/gpt-5',
        currentQuickMode: false,
        currentComputerUse: true,
      });

      expect(result).toEqual({
        modelId: IMAGE_GENERATION_MODEL_ID,
        quickModeEnabled: true,
        computerUseEnabled: false,
      });
    });

    it('keeps current routing when no auto-route condition is met', () => {
      const result = resolveRoutingOverrides({
        prompt: 'Help me debug this TypeScript error',
        hasAttachments: false,
        currentModelId: 'openai/gpt-5',
        currentQuickMode: false,
        currentComputerUse: true,
      });

      expect(result).toEqual({
        modelId: 'openai/gpt-5',
        quickModeEnabled: false,
        computerUseEnabled: true,
      });
    });

    it('normalizes absent current model id to null while preserving optional flags', () => {
      const result = resolveRoutingOverrides({
        prompt: 'Summarize this run',
        hasAttachments: false,
      });

      expect(result).toEqual({
        modelId: null,
        quickModeEnabled: undefined,
        computerUseEnabled: undefined,
      });
    });

    it('builds prompt metadata with undefined model when no model is selected', () => {
      const result = buildPromptRoutingMetadata({
        prompt: 'Summarize this run',
        hasAttachments: false,
      });

      expect(result).toEqual({
        modelId: undefined,
        quickModeEnabled: undefined,
        computerUseEnabled: undefined,
      });
    });

    it('builds prompt metadata with media auto-route overrides', () => {
      expect(
        buildPromptRoutingMetadata({
          prompt: 'Create a poster for the launch',
          hasAttachments: false,
          currentModelId: 'openai/gpt-5',
          currentQuickMode: false,
          currentComputerUse: true,
        })
      ).toEqual({
        modelId: IMAGE_GENERATION_MODEL_ID,
        quickModeEnabled: true,
        computerUseEnabled: false,
      });

      expect(
        buildPromptRoutingMetadata({
          prompt: 'Turn this reference into a short video',
          hasAttachments: true,
          currentModelId: 'openai/gpt-5',
          currentQuickMode: false,
          currentComputerUse: true,
        })
      ).toEqual({
        modelId: VIDEO_GENERATION_MODEL_ID,
        quickModeEnabled: true,
        computerUseEnabled: false,
      });
    });
  });
});
