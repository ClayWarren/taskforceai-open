import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, mock } from 'bun:test';

import '../../../../tests/setup/dom';

const getDesktopWorkspaceFileTree = mock(async () => ({
  root: '/workspace',
  roots: ['/workspace'],
  truncated: false,
  entries: [
    { path: 'src', name: 'src', depth: 0, isDirectory: true },
    { path: 'src/app.tsx', name: 'app.tsx', depth: 1, isDirectory: false },
    { path: 'README.md', name: 'README.md', depth: 0, isDirectory: false },
  ],
}));
const readDesktopWorkspaceFile = mock(async ({ path }: { path: string }) => ({
  root: '/workspace',
  path,
  content: '# Hello from the workspace',
  editable: false,
  truncated: false,
}));
const writeDesktopWorkspaceFile = mock();

mock.module('../platform/app-server', () => ({
  getDesktopWorkspaceFileTree,
  readDesktopWorkspaceFile,
  writeDesktopWorkspaceFile,
}));

import { WorkspaceFileTreePanel } from './WorkspaceFileTreePanel';

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
};

describe('WorkspaceFileTreePanel', () => {
  afterEach(() => {
    cleanup();
    getDesktopWorkspaceFileTree.mockClear();
    readDesktopWorkspaceFile.mockClear();
  });

  it('loads, filters, previews, refreshes, and closes the workspace file tree', async () => {
    const onClose = mock();
    render(<WorkspaceFileTreePanel isOpen={true} onClose={onClose} />);

    expect(screen.getByLabelText('Workspace files')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('app.tsx')).toBeTruthy());
    expect(getDesktopWorkspaceFileTree).toHaveBeenCalledWith({
      maxDepth: 7,
      maxEntries: 900,
    });

    const user = userEvent.setup({ document: globalThis.document });
    await user.type(screen.getByPlaceholderText('Filter files'), 'readme');
    await waitFor(() => expect(screen.queryByText('app.tsx')).toBeNull());
    expect(screen.getByText('README.md')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Open README.md' }));
    await waitFor(() =>
      expect(readDesktopWorkspaceFile).toHaveBeenCalledWith({
        root: '/workspace',
        path: 'README.md',
        maxBytes: 128 * 1024,
      })
    );
    expect(screen.getByText('# Hello from the workspace')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Refresh files'));
    await waitFor(() => expect(getDesktopWorkspaceFileTree).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByLabelText('Close files'));
    expect(onClose).toHaveBeenCalled();
  });

  it('keeps the latest file preview when an earlier read finishes last', async () => {
    const firstRead = createDeferred<{
      root: string;
      path: string;
      content: string;
      editable: boolean;
      truncated: boolean;
    }>();
    const secondRead = createDeferred<{
      root: string;
      path: string;
      content: string;
      editable: boolean;
      truncated: boolean;
    }>();
    readDesktopWorkspaceFile
      .mockImplementationOnce(() => firstRead.promise)
      .mockImplementationOnce(() => secondRead.promise);
    render(<WorkspaceFileTreePanel isOpen={true} onClose={mock()} />);
    await waitFor(() => expect(screen.getByText('app.tsx')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Open src/app.tsx' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open README.md' }));
    secondRead.resolve({
      root: '/workspace',
      path: 'README.md',
      content: 'latest preview',
      editable: true,
      truncated: false,
    });
    await waitFor(() => expect(screen.getByText('latest preview')).toBeTruthy());
    firstRead.resolve({
      root: '/workspace',
      path: 'src/app.tsx',
      content: 'stale preview',
      editable: true,
      truncated: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.queryByText('stale preview')).toBeNull();
    expect(screen.getAllByText('README.md')).toHaveLength(2);
    expect(screen.getByLabelText('Filter workspace files')).toBeTruthy();
  });

  it('can reload after closing during an in-flight tree request', async () => {
    const firstTree = createDeferred<{
      root: string;
      roots: string[];
      truncated: boolean;
      entries: Array<{
        path: string;
        name: string;
        depth: number;
        isDirectory: boolean;
      }>;
    }>();
    getDesktopWorkspaceFileTree.mockImplementationOnce(() => firstTree.promise);
    const onClose = mock();
    const { rerender } = render(<WorkspaceFileTreePanel isOpen={true} onClose={onClose} />);
    await waitFor(() => expect(getDesktopWorkspaceFileTree).toHaveBeenCalledTimes(1));

    rerender(<WorkspaceFileTreePanel isOpen={false} onClose={onClose} />);
    firstTree.resolve({ root: '/workspace', roots: ['/workspace'], truncated: false, entries: [] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    rerender(<WorkspaceFileTreePanel isOpen={true} onClose={onClose} />);

    await waitFor(() => expect(getDesktopWorkspaceFileTree).toHaveBeenCalledTimes(2));
  });

  it('requires confirmation before discarding edits on root changes or close', async () => {
    const confirm = mock(() => false);
    Object.defineProperty(window, 'confirm', {
      configurable: true,
      value: confirm,
    });
    getDesktopWorkspaceFileTree.mockResolvedValueOnce({
      root: '/workspace',
      roots: ['/workspace', '/other'],
      truncated: false,
      entries: [{ path: 'README.md', name: 'README.md', depth: 0, isDirectory: false }],
    });
    readDesktopWorkspaceFile.mockResolvedValueOnce({
      root: '/workspace',
      path: 'README.md',
      content: '# Hello from the workspace',
      editable: true,
      truncated: false,
    });
    const onClose = mock();
    render(<WorkspaceFileTreePanel isOpen={true} onClose={onClose} />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Open README.md' })).toBeTruthy()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open README.md' }));
    const editor = await screen.findByLabelText('Edit README.md');
    const user = userEvent.setup({ document: globalThis.document });
    await user.clear(editor);
    await user.type(editor, 'unsaved draft');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(false)
    );

    fireEvent.change(screen.getByLabelText('Workspace root'), { target: { value: '/other' } });
    fireEvent.click(screen.getByLabelText('Close files'));

    expect(confirm).toHaveBeenCalledTimes(2);
    expect(onClose).not.toHaveBeenCalled();
    expect(getDesktopWorkspaceFileTree).toHaveBeenCalledTimes(1);
    expect((editor as HTMLTextAreaElement).value).toContain('unsaved draft');

    confirm.mockReturnValue(true);
    fireEvent.change(screen.getByLabelText('Workspace root'), { target: { value: '/other' } });
    await waitFor(() => expect(getDesktopWorkspaceFileTree).toHaveBeenCalledTimes(2));
  });
});
