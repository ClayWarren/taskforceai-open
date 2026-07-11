import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { voiceManager } from './index';
import type { VoiceAdapter } from './types';

const createStubAdapter = (): VoiceAdapter => ({
  init: async () => {},
  speak: async (_text: string) => {},
  listen: async () => '',
  record: async () => ({ data: '', format: 'wav' }),
  cancel: async () => {},
});

// In test environment (BUN_TEST=1), these are stubs
const resetVoiceManager = async () => {
  try {
    await voiceManager.cancel();
  } catch {
    // cancel is best-effort between randomized tests
  }
  // setAdapter no-ops when the adapter reference is unchanged, so use a fresh stub.
  voiceManager.setAdapter(createStubAdapter());
};

describe('voice/index', () => {
  beforeEach(async () => {
    await resetVoiceManager();
  });

  afterEach(async () => {
    await resetVoiceManager();
  });
  describe('voiceManager exports', () => {
    it('exports voiceManager', () => {
      expect(voiceManager).toBeDefined();
    });

    it('voiceManager has setAdapter method', () => {
      expect(typeof voiceManager.setAdapter).toBe('function');
    });

    it('voiceManager has getStatus method', () => {
      expect(typeof voiceManager.getStatus).toBe('function');
    });

    it('voiceManager has getError method', () => {
      expect(typeof voiceManager.getError).toBe('function');
    });

    it('voiceManager has init method', () => {
      expect(typeof voiceManager.init).toBe('function');
    });

    it('voiceManager has speak method', () => {
      expect(typeof voiceManager.speak).toBe('function');
    });

    it('voiceManager has listen method', () => {
      expect(typeof voiceManager.listen).toBe('function');
    });

    it('voiceManager has cancel method', () => {
      expect(typeof voiceManager.cancel).toBe('function');
    });

    it('getStatus returns idle in test mode', () => {
      expect(voiceManager.getStatus()).toBe('idle');
    });

    it('getError returns null in test mode', () => {
      expect(voiceManager.getError()).toBeNull();
    });

    it('setAdapter does not throw', () => {
      expect(() => voiceManager.setAdapter(createStubAdapter())).not.toThrow();
    });

    it('init resolves in test mode', async () => {
      expect(await voiceManager.init()).toBeUndefined();
    });

    it('speak resolves in test mode', async () => {
      expect(await voiceManager.speak('test')).toBeUndefined();
    });

    it('listen returns empty string in test mode', async () => {
      const result = await voiceManager.listen();
      expect(result).toBe('');
    });

    it('cancel resolves in test mode', async () => {
      expect(await voiceManager.cancel()).toBeUndefined();
    });
  });
});
