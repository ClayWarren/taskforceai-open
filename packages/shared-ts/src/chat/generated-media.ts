export type GeneratedMediaKind = 'image' | 'video';

export interface GeneratedMediaResult {
  kind: GeneratedMediaKind;
  uri: string;
}

const MARKDOWN_IMAGE_PATTERN = /!\[[^\]]*generated[^\]]*\]\(([^)\s]+)\)/i;
const HTML_IMAGE_PATTERN = /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/i;
const HTML_VIDEO_SOURCE_PATTERN = /<source\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/i;
const HTML_VIDEO_PATTERN = /<video\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/i;
const VIDEO_DOWNLOAD_PATTERN = /\[[^\]]*(?:download\s+)?generated\s+video[^\]]*\]\(([^)\s]+)\)/i;

export function extractGeneratedMediaResult(
  content: string | null | undefined
): GeneratedMediaResult | null {
  if (!content) {
    return null;
  }

  const source = String(content);
  const videoUri = firstAllowedMediaUri(source, [
    HTML_VIDEO_SOURCE_PATTERN,
    HTML_VIDEO_PATTERN,
    VIDEO_DOWNLOAD_PATTERN,
  ]);
  if (videoUri) {
    return { kind: 'video', uri: videoUri };
  }

  const imageUri = firstAllowedMediaUri(source, [MARKDOWN_IMAGE_PATTERN, HTML_IMAGE_PATTERN]);
  if (imageUri) {
    return { kind: 'image', uri: imageUri };
  }

  return null;
}

export function stripGeneratedMediaMarkup(content: string): string {
  return content
    .replace(/<video\b[\s\S]*?<\/video>/gi, '')
    .replace(VIDEO_DOWNLOAD_PATTERN, '')
    .replace(MARKDOWN_IMAGE_PATTERN, '')
    .replace(HTML_IMAGE_PATTERN, '')
    .trim();
}

function firstAllowedMediaUri(source: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = pattern.exec(source);
    const uri = match?.[1]?.trim();
    if (uri && isAllowedMediaUri(uri)) {
      return uri;
    }
  }
  return null;
}

function isAllowedMediaUri(uri: string): boolean {
  return (
    uri.startsWith('https://') || uri.startsWith('data:image/') || uri.startsWith('data:video/')
  );
}
