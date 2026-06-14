import { describe, expect, it } from 'bun:test';

import { parseCodeExecutionPreview, parseDiffPreview } from './parsers';

describe('tool-usage/parsers', () => {
  describe('parseCodeExecutionPreview', () => {
    it('preserves empty output values from valid JSON previews', () => {
      expect(parseCodeExecutionPreview('{"output":""}')).toEqual({ output: '' });
    });

    it('preserves empty errors values from valid JSON previews', () => {
      expect(parseCodeExecutionPreview('{"errors":""}')).toEqual({ errors: '' });
    });

    it('returns raw preview when parsed payload has no output fields', () => {
      expect(parseCodeExecutionPreview('{"foo":"bar"}')).toEqual({ raw: '{"foo":"bar"}' });
    });
  });

  describe('parseDiffPreview', () => {
    const diff = [
      'diff --git a/src/app.ts b/src/app.ts',
      'index 1111111..2222222 100644',
      '--- a/src/app.ts',
      '+++ b/src/app.ts',
      '@@ -1,3 +1,4 @@',
      ' import { start } from "./runtime";',
      '-const mode = "old";',
      '+const mode = "new";',
      '+start(mode);',
      ' export { mode };',
    ].join('\n');

    it('parses unified diff file summaries and changed lines', () => {
      const preview = parseDiffPreview(diff);

      expect(preview).not.toBeNull();
      expect(preview?.additions).toBe(2);
      expect(preview?.deletions).toBe(1);
      expect(preview?.files[0]?.path).toBe('src/app.ts');
      expect(preview?.files[0]?.lines.some((line) => line.kind === 'hunk')).toBe(true);
      expect(preview?.files[0]?.lines.some((line) => line.kind === 'addition')).toBe(true);
    });

    it('finds nested diff payloads in metadata-like objects', () => {
      const preview = parseDiffPreview({ metadata: { patch: diff } });

      expect(preview?.files).toHaveLength(1);
      expect(preview?.files[0]?.additions).toBe(2);
    });

    it('returns null when no diff is present', () => {
      expect(parseDiffPreview({ metadata: { file: '/test.txt' } })).toBeNull();
    });
  });
});
