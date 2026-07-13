import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, mock } from 'bun:test';

import '../../../../tests/setup/dom';

const writeDesktopWorkspaceFile = mock();

mock.module('../lib/platform/desktop/app-server', () => ({
  writeDesktopWorkspaceFile,
}));

mock.module('../components/markdown/ChunkedMarkdown', () => ({
  default: ({ content }: { content: string }) => <div>{content}</div>,
}));

import {
  buildWorkspaceRevisionPrompt,
  selectedRangeFromText,
  WorkspaceFileEditor,
} from './WorkspaceFileEditor';

const file = {
  root: '/workspace',
  path: 'src/app.ts',
  content: 'alpha\nbeta\n',
  truncated: false,
  editable: true,
};

describe('WorkspaceFileEditor', () => {
  afterEach(() => {
    cleanup();
    writeDesktopWorkspaceFile.mockReset();
  });

  it('saves through the guarded workspace boundary with the original content revision', async () => {
    const saved = { ...file, content: 'alpha\ngamma\n' };
    writeDesktopWorkspaceFile.mockResolvedValue(saved);
    const onSaved = mock();
    render(<WorkspaceFileEditor file={file} isLoading={false} onSaved={onSaved} />);

    const editor = screen.getByLabelText('Edit src/app.ts');
    const user = userEvent.setup({ document: globalThis.document });
    await user.clear(editor);
    await user.type(editor, saved.content);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(writeDesktopWorkspaceFile).toHaveBeenCalledWith({
        root: '/workspace',
        path: 'src/app.ts',
        content: saved.content,
        expectedContent: file.content,
      })
    );
    expect(onSaved).toHaveBeenCalledWith(saved);
    expect(await screen.findByText('Saved.')).toBeTruthy();
  });

  it('adds line annotations and sends a selected revision request to the composer', async () => {
    const onInsertIntoComposer = mock();
    render(
      <WorkspaceFileEditor
        file={file}
        isLoading={false}
        onSaved={mock()}
        onInsertIntoComposer={onInsertIntoComposer}
      />
    );
    const editor = screen.getByLabelText('Edit src/app.ts') as HTMLTextAreaElement;
    editor.setSelectionRange(0, 10);
    fireEvent.select(editor);

    expect(screen.getByText('Selected lines 1-2')).toBeTruthy();
    const user = userEvent.setup({ document: globalThis.document });
    await user.type(screen.getByLabelText('Annotation note'), 'Keep this pure');
    fireEvent.click(screen.getByRole('button', { name: 'Annotate' }));
    expect(screen.getByText('Lines 1-2: Keep this pure')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Revise in composer' }));
    expect(onInsertIntoComposer).toHaveBeenCalledTimes(1);
    expect(onInsertIntoComposer.mock.calls[0]?.[0]).toContain('`src/app.ts` lines 1-2');
    expect(onInsertIntoComposer.mock.calls[0]?.[0]).toContain('Keep this pure');
  });

  it('keeps truncated previews read-only', () => {
    render(
      <WorkspaceFileEditor
        file={{ ...file, editable: false, truncated: true }}
        isLoading={false}
        onSaved={mock()}
      />
    );

    expect(screen.getByText('This preview is truncated and cannot be edited safely.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('calculates bounded selections and revision prompts', () => {
    expect(selectedRangeFromText('alpha\nbeta', 3, 3)).toBeNull();
    const selection = selectedRangeFromText('alpha\nbeta', -10, 99);
    expect(selection).toEqual({
      start: 0,
      end: 10,
      startLine: 1,
      endLine: 2,
      text: 'alpha\nbeta',
    });
    expect(buildWorkspaceRevisionPrompt('notes.md', selection!, [])).toContain(
      '`notes.md` lines 1-2'
    );
    const singleLine = selectedRangeFromText('alpha', 0, 5)!;
    expect(
      buildWorkspaceRevisionPrompt('notes.md', singleLine, [
        { ...singleLine, id: 'note-1', note: 'Tighten this' },
      ])
    ).toContain('- line 1: Tighten this');
  });

  it('renders empty, loading, and non-text states', () => {
    const { rerender } = render(<WorkspaceFileEditor file={null} isLoading onSaved={mock()} />);
    expect(screen.getByText('Loading...')).toBeTruthy();
    rerender(<WorkspaceFileEditor file={null} isLoading={false} onSaved={mock()} />);
    expect(screen.getByText('No file selected.')).toBeTruthy();
    rerender(
      <WorkspaceFileEditor
        file={{ ...file, editable: false, truncated: false }}
        isLoading={false}
        onSaved={mock()}
      />
    );
    expect(screen.getByText('This file is not valid editable text.')).toBeTruthy();
  });

  it('previews markdown, discards edits, and reports dirty state', async () => {
    const onDirtyChange = mock();
    const markdownFile = { ...file, path: 'README.MD', content: '# Alpha' };
    const { unmount } = render(
      <WorkspaceFileEditor
        file={markdownFile}
        isLoading={false}
        onSaved={mock()}
        onDirtyChange={onDirtyChange}
      />
    );
    const editor = screen.getByLabelText('Edit README.MD');
    const user = userEvent.setup({ document: globalThis.document });
    await user.clear(editor);
    await user.type(editor, '# Beta');
    await waitFor(() => expect(onDirtyChange).toHaveBeenCalledWith(true));
    fireEvent.click(screen.getByRole('button', { name: 'Preview Markdown' }));
    expect(screen.getByLabelText('Markdown preview').textContent).toContain('# Beta');
    fireEvent.click(screen.getByRole('button', { name: 'Edit Markdown' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect((screen.getByLabelText('Edit README.MD') as HTMLTextAreaElement).value).toBe('# Alpha');
    unmount();
    expect(onDirtyChange).toHaveBeenCalledWith(false);
  });

  it('removes annotations and reports both error shapes while saving', async () => {
    writeDesktopWorkspaceFile
      .mockRejectedValueOnce(new Error('Revision conflict'))
      .mockRejectedValueOnce('Bridge offline');
    render(<WorkspaceFileEditor file={file} isLoading={false} onSaved={mock()} />);
    const editor = screen.getByLabelText('Edit src/app.ts') as HTMLTextAreaElement;
    editor.setSelectionRange(0, 5);
    fireEvent.select(editor);
    const user = userEvent.setup({ document: globalThis.document });
    await user.type(screen.getByLabelText('Annotation note'), '  note  ');
    fireEvent.click(screen.getByRole('button', { name: 'Annotate' }));
    expect(screen.getByText('Lines 1-1: note')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove annotation note' }));
    expect(screen.queryByText('Lines 1-1: note')).toBeNull();

    await user.clear(editor);
    await user.type(editor, 'changed');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Revision conflict')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Bridge offline')).toBeTruthy();
  });
});
