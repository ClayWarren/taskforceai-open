import { describe, expect, it } from 'bun:test';

import { DesktopVoiceAdapter } from './adapters/desktop';
import { NoopVoiceAdapter } from './adapters/noop';
import { WebVoiceAdapter } from './adapters/web';
import { defaultAdapterFactory } from './defaultAdapterFactory';

describe('voice/defaultAdapterFactory', () => {
  it('returns web adapter for web platform', async () => {
    expect(await defaultAdapterFactory('web')).toBeInstanceOf(WebVoiceAdapter);
  });

  it('returns desktop adapter for desktop platform', async () => {
    expect(await defaultAdapterFactory('desktop')).toBeInstanceOf(DesktopVoiceAdapter);
  });

  it('returns noop adapter for mobile and unknown platforms', async () => {
    expect(await defaultAdapterFactory('mobile')).toBeInstanceOf(NoopVoiceAdapter);
    expect(await defaultAdapterFactory('unknown')).toBeInstanceOf(NoopVoiceAdapter);
  });
});
