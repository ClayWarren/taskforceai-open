import { describe, expect, it } from 'bun:test';

describe('MobileVoiceAdapter', () => {
  describe('constructor', () => {
    it('creates adapter instance', () => {
      const { MobileVoiceAdapter } = require('../../voice/mobileAdapter');
      const adapter = new MobileVoiceAdapter();
      expect(adapter).toBeDefined();
    });
  });

  describe('record', () => {
    it('throws not supported error', async () => {
      const { MobileVoiceAdapter } = require('../../voice/mobileAdapter');
      const adapter = new MobileVoiceAdapter();
      
      await expect(adapter.record()).rejects.toThrow('Native audio recording is not yet supported in Mobile.');
    });
  });
});
