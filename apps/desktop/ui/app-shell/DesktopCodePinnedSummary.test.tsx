import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, mock } from 'bun:test';

import '../../../../tests/setup/dom';

const getDesktopGitReviewStatus = mock(async () => ({
  isGitRepository: true,
  workspace: '/workspace/taskforceai',
  branch: 'main',
  hasStagedChanges: false,
  hasUnstagedChanges: true,
  hasUntrackedFiles: false,
  files: [],
  message: '',
}));
const getDesktopGitReviewDiff = mock(async () => ({
  isGitRepository: true,
  workspace: '/workspace/taskforceai',
  scope: 'allBranchChanges' as const,
  rawDiff: '--- a/file.ts\n+++ b/file.ts\n-old\n+new\n+another',
  files: [],
  truncated: false,
  message: '',
}));

mock.module('@taskforceai/web/app/lib/desktop/task-mode', () => ({
  readDesktopCodeWorkspaceRoots: () => ['/workspace/taskforceai'],
}));
mock.module('../platform/app-server', () => ({
  getDesktopGitReviewDiff,
  getDesktopGitReviewStatus,
}));

import { DesktopCodePinnedSummary, countDesktopDiffLines } from './DesktopCodePinnedSummary';

describe('DesktopCodePinnedSummary', () => {
  afterEach(() => cleanup());

  it('counts changed lines without diff headers', () => {
    expect(countDesktopDiffLines('--- a/file\n+++ b/file\n-a\n+b\n+c')).toEqual({
      additions: 2,
      deletions: 1,
    });
  });

  it('shows live environment state and opens existing Code surfaces', async () => {
    const onOpenEnvironment = mock();
    const onReviewChanges = mock();
    render(
      <DesktopCodePinnedSummary
        sources={[{ url: 'https://github.com/taskforceai' }]}
        onOpenEnvironment={onOpenEnvironment}
        onReviewChanges={onReviewChanges}
      />
    );

    await waitFor(() => expect(screen.getByText('main')).toBeDefined());
    expect(screen.getByText('+2')).toBeDefined();
    expect(screen.getByText('-1')).toBeDefined();
    expect(screen.getByRole('link', { name: /github.com/ }).getAttribute('href')).toBe(
      'https://github.com/taskforceai'
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open Code environment' }));
    fireEvent.click(screen.getByRole('button', { name: /Changes/ }));
    expect(onOpenEnvironment).toHaveBeenCalledTimes(1);
    expect(onReviewChanges).toHaveBeenCalledTimes(1);
  });

  it('keeps the pinned summary usable when review status refresh fails', async () => {
    getDesktopGitReviewStatus.mockRejectedValueOnce(new Error('status unavailable'));
    render(
      <DesktopCodePinnedSummary sources={[]} onOpenEnvironment={mock()} onReviewChanges={mock()} />
    );

    await waitFor(() => expect(getDesktopGitReviewStatus).toHaveBeenCalled());
    expect(screen.getAllByText('Local').length).toBeGreaterThan(0);
  });
});
