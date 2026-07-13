import { describe, expect, it } from 'bun:test';

import { extractGeneratedMediaResult, stripGeneratedMediaMarkup } from './generated-media';

describe('generated media helpers', () => {
  it('extracts generated image markdown', () => {
    expect(
      extractGeneratedMediaResult('![Generated Image](https://example.test/image.png)')
    ).toEqual({
      kind: 'image',
      uri: 'https://example.test/image.png',
    });
    expect(extractGeneratedMediaResult(null)).toBeNull();
  });

  it('extracts generated video sources', () => {
    expect(
      extractGeneratedMediaResult(
        '<video controls><source src="https://example.test/generated.mp4" type="video/mp4"></video>'
      )
    ).toEqual({
      kind: 'video',
      uri: 'https://example.test/generated.mp4',
    });
  });

  it('strips generated media markup while preserving surrounding text', () => {
    expect(
      stripGeneratedMediaMarkup(
        'Here you go.\n\n![Generated Image](https://example.test/image.png)'
      )
    ).toBe('Here you go.');
  });
});
