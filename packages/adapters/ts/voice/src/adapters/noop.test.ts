import { describe, expect, it } from 'bun:test';

import { NoopVoiceAdapter } from './noop';

describe('voice/adapters/noop', () => {
  describe('NoopVoiceAdapter', () => {
    it('creates instance', () => {
      const adapter = new NoopVoiceAdapter();
      expect(adapter).toBeInstanceOf(NoopVoiceAdapter);
    });

    describe('init', () => {
      it('throws error indicating voice not supported', async () => {
        const adapter = new NoopVoiceAdapter();

        await expect((async () => adapter.init())()).rejects.toThrow(
          'Voice features are not supported on this platform.'
        );
      });
    });

    describe('speak', () => {
      it('throws error indicating voice not supported', async () => {
        const adapter = new NoopVoiceAdapter();

        await expect((async () => adapter.speak('Hello'))()).rejects.toThrow(
          'Voice features are not supported on this platform.'
        );
      });
    });

    describe('listen', () => {
      it('throws error indicating voice not supported', async () => {
        const adapter = new NoopVoiceAdapter();

        await expect((async () => adapter.listen())()).rejects.toThrow(
          'Voice features are not supported on this platform.'
        );
      });
    });

    describe('record', () => {
      it('throws error indicating voice not supported', async () => {
        const adapter = new NoopVoiceAdapter();

        await expect((async () => adapter.record())()).rejects.toThrow(
          'Voice features are not supported on this platform.'
        );
      });
    });

    describe('cancel', () => {
      it('resolves without error', async () => {
        const adapter = new NoopVoiceAdapter();

        expect(await adapter.cancel()).toBeUndefined();
      });

      it('can be called multiple times', async () => {
        const adapter = new NoopVoiceAdapter();

        await adapter.cancel();
        await adapter.cancel();

        // Should not throw
        expect(true).toBe(true);
      });
    });

    describe('error messages', () => {
      it('init error has correct message', async () => {
        const adapter = new NoopVoiceAdapter();

        try {
          await adapter.init();
        } catch (e) {
          expect((e as Error).message).toBe('Voice features are not supported on this platform.');
        }
      });

      it('speak error has correct message', async () => {
        const adapter = new NoopVoiceAdapter();

        try {
          await adapter.speak('test');
        } catch (e) {
          expect((e as Error).message).toBe('Voice features are not supported on this platform.');
        }
      });

      it('listen error has correct message', async () => {
        const adapter = new NoopVoiceAdapter();

        try {
          await adapter.listen();
        } catch (e) {
          expect((e as Error).message).toBe('Voice features are not supported on this platform.');
        }
      });

      it('record error has correct message', async () => {
        const adapter = new NoopVoiceAdapter();

        try {
          await adapter.record();
        } catch (e) {
          expect((e as Error).message).toBe('Voice features are not supported on this platform.');
        }
      });
    });
  });
});
