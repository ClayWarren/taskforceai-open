import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

import '../../../../tests/setup/dom';

const getDesktopGitReviewStatus = vi.fn(async () => ({
  isGitRepository: true,
  workspace: '/tmp/project',
  repositoryRoot: '/tmp/project',
  branch: 'main',
  hasStagedChanges: false,
  hasUnstagedChanges: true,
  hasUntrackedFiles: false,
  files: [
    {
      path: 'src/app.ts',
      staged: false,
      unstaged: true,
      untracked: false,
    },
  ],
  message: 'Changes ready.',
}));
const getDesktopGitReviewDiff = vi.fn(async () => ({
  isGitRepository: true,
  workspace: '/tmp/project',
  scope: 'allBranchChanges',
  rawDiff:
    'diff --git a/src/app.ts b/src/app.ts\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new\n',
  files: [{ path: 'src/app.ts', status: 'M' }],
  truncated: false,
  message: 'Diff ready.',
}));

vi.mock('../platform/app-server', () => ({
  getDesktopGitReviewStatus,
  getDesktopGitReviewDiff,
}));

import { DesktopCodeWorkspaceSurface } from './DesktopCodeWorkspaceSurface';

describe('DesktopCodeWorkspaceSurface', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(
      'taskforceai.desktop.code-workspace-roots.v2',
      JSON.stringify(['/tmp/project'])
    );
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('explains how to add a workspace when none is configured', async () => {
    window.localStorage.clear();
    render(
      <DesktopCodeWorkspaceSurface
        open
        view="empty"
        onOpenChange={vi.fn()}
        onViewChange={vi.fn()}
      />
    );

    expect(await screen.findByText(/Add a workspace with \/code <project-directory>/)).toBeTruthy();
    expect(getDesktopGitReviewStatus).not.toHaveBeenCalled();
    expect(getDesktopGitReviewDiff).not.toHaveBeenCalled();
  });

  it('shows review loading failures in the workspace launcher', async () => {
    getDesktopGitReviewStatus.mockRejectedValueOnce(new Error('Repository unavailable'));
    render(
      <DesktopCodeWorkspaceSurface
        open
        view="empty"
        onOpenChange={vi.fn()}
        onViewChange={vi.fn()}
      />
    );

    expect(await screen.findByText('Repository unavailable')).toBeTruthy();
  });

  it('opens branch review from the aggregate changes pill', async () => {
    const onOpenChange = vi.fn();
    const onViewChange = vi.fn();
    const { rerender } = render(
      <DesktopCodeWorkspaceSurface
        open={false}
        view="empty"
        onOpenChange={onOpenChange}
        onViewChange={onViewChange}
      />
    );

    const pill = await screen.findByRole('button', { name: 'Review workspace changes' });
    expect(pill.textContent).toContain('1 files changed');
    expect(pill.textContent).toContain('+1');
    expect(pill.textContent).toContain('-1');
    fireEvent.click(pill);
    expect(onViewChange).toHaveBeenCalledWith('review');
    expect(onOpenChange).toHaveBeenCalledWith(true);

    rerender(
      <DesktopCodeWorkspaceSurface
        open
        view="review"
        onOpenChange={onOpenChange}
        onViewChange={onViewChange}
      />
    );
    await waitFor(() => expect(screen.getByText('main')).toBeTruthy());
    expect(screen.getAllByText('src/app.ts')).toHaveLength(2);
  });

  it('uses the empty pane as the launcher for Code workspace tools', async () => {
    const onOpenChange = vi.fn();
    const onOpenTerminal = vi.fn();
    render(
      <DesktopCodeWorkspaceSurface
        open
        view="empty"
        onOpenChange={onOpenChange}
        onViewChange={vi.fn()}
        onOpenTerminal={onOpenTerminal}
      />
    );

    await screen.findByRole('button', { name: 'Review workspace changes' });
    fireEvent.click(screen.getByRole('button', { name: 'Terminal' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onOpenTerminal).toHaveBeenCalledTimes(1);
  });

  it('closes the Code workspace from the empty launcher', async () => {
    const onOpenChange = vi.fn();
    render(
      <DesktopCodeWorkspaceSurface
        open
        view="empty"
        onOpenChange={onOpenChange}
        onViewChange={vi.fn()}
      />
    );

    await screen.findByRole('button', { name: 'Review workspace changes' });
    fireEvent.click(screen.getByRole('button', { name: 'Close Code workspace' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
