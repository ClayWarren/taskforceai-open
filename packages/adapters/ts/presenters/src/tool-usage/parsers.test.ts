import { describe, expect, it } from 'bun:test';

import {
  parseCodeExecutionPreview,
  parseDiffPreview,
  parseSearchPreview,
  safeArgsForDisplay,
} from './parsers';

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

    it('finds nested diff payloads inside arrays and stringified JSON', () => {
      const preview = parseDiffPreview([JSON.stringify({ unified_diff: diff })]);

      expect(preview?.files[0]?.path).toBe('src/app.ts');
      expect(preview?.deletions).toBe(1);
    });

    it('parses diffs that only contain file headers', () => {
      const preview = parseDiffPreview(
        ['generated patch', '--- /dev/null', '+++ b/src/new.ts', '+export const value = 1;'].join(
          '\n'
        )
      );

      expect(preview?.files).toEqual([
        {
          path: 'src/new.ts',
          additions: 1,
          deletions: 0,
          lines: [
            { kind: 'meta', text: '+++ b/src/new.ts' },
            { kind: 'addition', text: '+export const value = 1;' },
          ],
        },
      ]);
    });

    it('returns null for scalar and array payloads without nested diffs', () => {
      expect(parseDiffPreview(42)).toBeNull();
      expect(parseDiffPreview(['plain text', { result: 'not a diff' }])).toBeNull();
    });

    it('classifies post-header diff metadata lines', () => {
      const preview = parseDiffPreview(
        [
          '--- a/src/app.ts',
          '+++ b/src/app.ts',
          'index 1111111..2222222 100644',
          '@@ -1 +1 @@',
          '-old',
          '+new',
        ].join('\n')
      );

      expect(preview?.files[0]?.lines).toContainEqual({
        kind: 'meta',
        text: 'index 1111111..2222222 100644',
      });
    });

    it('returns null when no diff is present', () => {
      expect(parseDiffPreview({ metadata: { file: '/test.txt' } })).toBeNull();
    });
  });

  describe('parseSearchPreview', () => {
    it('accepts legacy links payloads and defaults totals from link count', () => {
      expect(
        parseSearchPreview(
          JSON.stringify({
            links: [{ url: 'https://example.test', title: 'Example', snippet: 'Result' }],
          })
        )
      ).toEqual({
        results: [{ url: 'https://example.test', title: 'Example', snippet: 'Result' }],
        totalResults: 1,
      });
    });

    it('returns an empty result list for malformed previews', () => {
      expect(parseSearchPreview('not json')).toEqual({ results: [] });
    });
  });

  describe('safeArgsForDisplay', () => {
    it('accepts object arguments supplied as JSON strings', () => {
      expect(safeArgsForDisplay('{"query":"status"}')).toEqual({
        ok: true,
        value: { query: 'status' },
      });
    });

    it('rejects arrays and malformed JSON strings', () => {
      expect(safeArgsForDisplay('[{"query":"status"}]')).toEqual({
        ok: false,
        error: 'INVALID_ARGS',
      });
      expect(safeArgsForDisplay('{')).toEqual({ ok: false, error: 'INVALID_ARGS' });
    });
  });
});
