import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import type {
  DesktopWorkspaceFileTreeResult,
  DesktopWorktreeListResult,
} from '@taskforceai/contracts/app-server';

import '../../../../tests/setup/dom';

const emptyWorkspaceFileTree = (): DesktopWorkspaceFileTreeResult => ({
  root: '/workspace/repo',
  roots: ['/workspace/repo'],
  entries: [],
  truncated: false,
});
const emptyWorktreeList = (): DesktopWorktreeListResult => ({
  repositoryRoot: '/workspace/repo',
  worktrees: [],
});
const getDesktopWorkspaceFileTree = mock(async () => emptyWorkspaceFileTree());
const listDesktopWorktrees = mock(async () => emptyWorktreeList());
const enableDesktopLocalCoding = mock(async () => ({ enabled: true }));
const persistDesktopProjectWorkspace = mock();
const readDesktopCodeWorkspaceRoots = mock(() => ['/workspace/repo']);
const readDesktopProjectWorkspace = mock((): string | null => null);

mock.module('../platform/app-server', () => ({
  enableDesktopLocalCoding,
  getDesktopWorkspaceFileTree,
  listDesktopWorktrees,
}));

mock.module('@taskforceai/web/app/lib/desktop/task-mode', () => ({
  persistDesktopProjectWorkspace,
  readDesktopCodeWorkspaceRoots,
  readDesktopProjectWorkspace,
}));

import { DesktopWorkspaceMentionMenu } from './DesktopWorkspaceMentionMenu';
import { DesktopWorkspaceTargetSelector } from './DesktopWorkspaceTargetSelector';

describe('desktop workspace prompt controls', () => {
  beforeEach(() => {
    cleanup();
    getDesktopWorkspaceFileTree.mockReset();
    getDesktopWorkspaceFileTree.mockResolvedValue(emptyWorkspaceFileTree());
    listDesktopWorktrees.mockReset();
    listDesktopWorktrees.mockResolvedValue(emptyWorktreeList());
    enableDesktopLocalCoding.mockReset();
    enableDesktopLocalCoding.mockResolvedValue({ enabled: true });
    persistDesktopProjectWorkspace.mockClear();
    readDesktopCodeWorkspaceRoots.mockReset();
    readDesktopCodeWorkspaceRoots.mockReturnValue(['/workspace/repo']);
    readDesktopProjectWorkspace.mockReset();
    readDesktopProjectWorkspace.mockReturnValue(null);
  });

  afterEach(() => cleanup());

  it('loads, filters, sorts, and selects workspace mentions', async () => {
    getDesktopWorkspaceFileTree.mockResolvedValue({
      root: '/workspace/repo',
      roots: ['/workspace/repo'],
      entries: [
        { path: 'tests/src-helper.ts', name: 'src-helper.ts', depth: 2, isDirectory: false },
        { path: 'src', name: 'src', depth: 1, isDirectory: true },
        { path: 'src/app.ts', name: 'app.ts', depth: 2, isDirectory: false },
        { path: 'README.md', name: 'README.md', depth: 1, isDirectory: false },
      ],
      truncated: false,
    });
    const onSelect = mock();
    render(<DesktopWorkspaceMentionMenu query="src" onSelect={onSelect} />);

    const options = await screen.findAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      'src',
      'src/app.ts',
      'tests/src-helper.ts',
    ]);
    fireEvent.mouseDown(options[1]!);
    expect(onSelect).toHaveBeenCalledWith('src/app.ts');
    expect(getDesktopWorkspaceFileTree).toHaveBeenCalledWith({ maxDepth: 8, maxEntries: 1_500 });
  });

  it('shows empty and error states for workspace mentions', async () => {
    render(<DesktopWorkspaceMentionMenu query="missing" onSelect={mock()} />);
    expect(await screen.findByText('No workspace matches.')).toBeTruthy();

    cleanup();
    getDesktopWorkspaceFileTree.mockRejectedValueOnce(new Error('Tree unavailable'));
    render(<DesktopWorkspaceMentionMenu query="src" onSelect={mock()} />);
    expect(await screen.findByText('Tree unavailable')).toBeTruthy();
  });

  it('loads worktrees and activates the selected project workspace', async () => {
    readDesktopProjectWorkspace.mockReturnValue('/workspace/repo/feature');
    listDesktopWorktrees.mockResolvedValue({
      repositoryRoot: '/workspace/repo',
      worktrees: [
        {
          path: '/workspace/repo',
          branch: 'main',
          bare: false,
          detached: false,
          prunable: false,
        },
        {
          path: '/workspace/repo/feature',
          branch: null,
          bare: false,
          detached: true,
          prunable: false,
        },
      ],
    });
    render(<DesktopWorkspaceTargetSelector projectId={7} />);

    const select = await screen.findByRole('combobox', { name: 'Task worktree' });
    expect((select as HTMLSelectElement).value).toBe('/workspace/repo/feature');
    expect(screen.getByText(/Detached HEAD/)).toBeTruthy();
    fireEvent.change(select, { target: { value: '/workspace/repo' } });

    await waitFor(() =>
      expect(persistDesktopProjectWorkspace).toHaveBeenCalledWith(7, '/workspace/repo')
    );
    expect(enableDesktopLocalCoding).toHaveBeenCalledWith({ workspace: '/workspace/repo' });
    expect(listDesktopWorktrees).toHaveBeenCalledWith({ repository: '/workspace/repo' });
  });

  it('does not load or render worktrees without a repository or project', async () => {
    readDesktopCodeWorkspaceRoots.mockReturnValue([]);
    const { container, rerender } = render(<DesktopWorkspaceTargetSelector projectId={7} />);
    expect(container.firstChild).toBeNull();
    expect(listDesktopWorktrees).not.toHaveBeenCalled();

    readDesktopCodeWorkspaceRoots.mockReturnValue(['/workspace/repo']);
    rerender(<DesktopWorkspaceTargetSelector projectId={null} />);
    expect(container.firstChild).toBeNull();
  });
});
