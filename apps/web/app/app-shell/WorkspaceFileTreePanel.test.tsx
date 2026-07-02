import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, mock } from 'bun:test';

import '../../../../tests/setup/dom';

const getDesktopWorkspaceFileTree = mock(async () => ({
  root: '/workspace',
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
  truncated: false,
}));

mock.module('../lib/platform/desktop/app-server', () => ({
  getDesktopWorkspaceFileTree,
  readDesktopWorkspaceFile,
}));

import { WorkspaceFileTreePanel } from './WorkspaceFileTreePanel';

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
});
