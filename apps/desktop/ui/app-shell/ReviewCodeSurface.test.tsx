import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, mock } from 'bun:test';

import '../../../../tests/setup/dom';

import { parseReviewDiff, ReviewCodeSurface } from './ReviewCodeSurface';

const diff = `diff --git a/src/app.ts b/src/app.ts
index 111..222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,4 @@
 const first = true;
-const second = false;
+const second = true;
+const third = 3;
 return first;
diff --git a/src/other.ts b/src/other.ts
index 333..444 100644
--- a/src/other.ts
+++ b/src/other.ts
@@ -1 +1 @@
-export const value = 1;
+export const value = 2;`;

describe('ReviewCodeSurface', () => {
  afterEach(cleanup);

  it('parses file statistics and addressable old and new lines', () => {
    const files = parseReviewDiff(diff);

    expect(files).toHaveLength(2);
    expect(files[0]).toMatchObject({ path: 'src/app.ts', additions: 2, deletions: 1 });
    expect(files[0]?.lines.find((line) => line.content === 'const second = true;')).toMatchObject({
      kind: 'addition',
      newLine: 2,
      oldLine: null,
    });
    expect(parseReviewDiff(`${diff}\n\\ No newline at end of file`)[1]?.lines.at(-1)?.kind).toBe(
      'meta'
    );
  });

  it('selects comment ranges, switches files and expands large previews', async () => {
    const onSelectRange = mock();
    render(
      <ReviewCodeSurface
        comments={[
          {
            id: 'comment-1',
            workspace: '/workspace',
            path: 'src/app.ts',
            line: 2,
            endLine: 3,
            body: 'Review this range',
            resolved: false,
            createdAt: 1,
            updatedAt: 1,
          },
        ]}
        initialMaxLines={3}
        onSelectRange={onSelectRange}
        rawDiff={diff}
      />
    );
    await waitFor(() => expect(document.querySelector('.token')).toBeTruthy());

    fireEvent.click(screen.getByLabelText('Comment on src/app.ts line 2'));
    expect(screen.getByRole('button', { name: /Show \d+ more lines/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Show \d+ more lines/ }));
    fireEvent.click(screen.getByLabelText('Comment on src/app.ts line 3'), { shiftKey: true });

    expect(onSelectRange).toHaveBeenLastCalledWith({
      path: 'src/app.ts',
      line: 2,
      endLine: 3,
    });
    expect(screen.queryByRole('button', { name: /Show \d+ more lines/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'src/other.ts +1 -1' }));
    expect(screen.getAllByText('src/other.ts').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByLabelText('Split diff'));
    expect(screen.getByLabelText('Unified diff')).toBeTruthy();
  });

  it('detects supported review languages and renders a custom empty state', () => {
    const extensions = ['js', 'py', 'sh', 'rs', 'go', 'json', 'yaml'];
    const languageDiff = extensions
      .map(
        (extension) =>
          `diff --git a/file.${extension} b/file.${extension}\n--- a/file.${extension}\n+++ b/file.${extension}\n@@ -1 +1 @@\n-old\n+new`
      )
      .join('\n');
    const { rerender } = render(<ReviewCodeSurface rawDiff={languageDiff} />);

    for (const extension of extensions.slice(1)) {
      fireEvent.click(screen.getByRole('button', { name: `file.${extension} +1 -1` }));
      expect(screen.getAllByText(`file.${extension}`).length).toBeGreaterThan(0);
    }

    rerender(<ReviewCodeSurface rawDiff="" emptyMessage="Nothing changed." />);
    expect(screen.getByText('Nothing changed.')).toBeTruthy();
  });
});
