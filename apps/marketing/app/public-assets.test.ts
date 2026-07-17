import path from 'node:path';
import { describe, expect, it } from 'bun:test';

type ManifestIcon = {
  src: string;
  sizes: string;
};

function pngDimensions(bytes: Uint8Array): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return `${view.getUint32(16)}x${view.getUint32(20)}`;
}

describe('marketing public assets', () => {
  it('declares the real dimensions of every PNG manifest icon', async () => {
    const repoRoot = path.resolve(import.meta.dir, '../../..');
    const manifest = (await Bun.file(
      path.join(repoRoot, 'config/public-assets/marketing-manifest.json')
    ).json()) as { icons: ManifestIcon[] };

    for (const icon of manifest.icons) {
      const imagePath = path.join(repoRoot, 'apps/marketing/public', icon.src.replace(/^\//, ''));
      const bytes = new Uint8Array(await Bun.file(imagePath).arrayBuffer());
      expect(pngDimensions(bytes)).toBe(icon.sizes);
    }
  });
});
