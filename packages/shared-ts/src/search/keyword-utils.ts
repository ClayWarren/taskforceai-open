const STRUCTURAL_TOKENS = new Set(['point', 'group', 'symmetry']);

export const normalizeQueryForCache = (input: string): string =>
  input.trim().toLowerCase().replace(/\s+/g, ' ');

export const extractKeywordTokens = (input: string): string[] => {
  const rawTokens = input
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  const canonicalTokens: string[] = [];
  for (const token of rawTokens) {
    if (token === 'c3h' || token === 'c3v' || token === 'd3h') {
      canonicalTokens.push(token);
      continue;
    }
    const lettersOnly = token.replace(/[^a-z]/g, '');
    if (lettersOnly.length >= 3) {
      canonicalTokens.push(lettersOnly);
    }
  }

  return Array.from(new Set(canonicalTokens));
};

export const removeStructuralTokens = (tokens: string[]): string[] =>
  tokens.filter((token) => !STRUCTURAL_TOKENS.has(token));
