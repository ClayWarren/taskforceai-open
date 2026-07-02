export function summarizeGeneratedMediaResult(result?: string): string | null {
  if (!result) {
    return null;
  }

  const normalized = result.toLowerCase();
  if (
    normalized.includes('<video') ||
    normalized.includes('download generated video') ||
    normalized.includes('generated video') ||
    normalized.includes('xai-vidgen-bucket') ||
    normalized.includes('vidgen.x.ai')
  ) {
    return 'Generated video ready.';
  }
  if (
    normalized.includes('![generated image]') ||
    normalized.includes('data:image/') ||
    normalized.includes('<img') ||
    normalized.includes('generated image')
  ) {
    return 'Generated image ready.';
  }
  return null;
}
