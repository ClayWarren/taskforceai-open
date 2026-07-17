import { beforeEach, describe, expect, it } from 'bun:test';

import '../../../../../tests/setup/dom';
import {
  persistDesktopCodeWorkspace,
  persistDesktopCodeWorkspaceRoots,
  persistDesktopProjectWorkspace,
  persistDesktopTaskMode,
  readDesktopCodeWorkspace,
  readDesktopCodeWorkspaceRoots,
  readDesktopProjectWorkspace,
  readDesktopTaskMode,
} from './task-mode';

describe('desktop task mode storage', () => {
  beforeEach(() => window.localStorage.clear());

  it('defaults invalid or missing values to Chat', () => {
    expect(readDesktopTaskMode()).toBe('chat');
    window.localStorage.setItem('taskforceai.desktop.task-mode.v1', 'invalid');
    expect(readDesktopTaskMode()).toBe('chat');
  });

  it('persists deduplicated Code roots and migrates the legacy workspace', () => {
    persistDesktopCodeWorkspace('/tmp/legacy');
    expect(readDesktopCodeWorkspaceRoots()).toEqual(['/tmp/legacy']);

    persistDesktopCodeWorkspaceRoots(['/tmp/app', ' /tmp/shared ', '/tmp/app']);
    expect(readDesktopCodeWorkspaceRoots()).toEqual(['/tmp/app', '/tmp/shared']);
    expect(readDesktopCodeWorkspace()).toBe('/tmp/app');
  });

  it('persists every selected mode and normalized Code workspace', () => {
    for (const mode of ['chat', 'work', 'code'] as const) {
      persistDesktopTaskMode(mode);
      expect(readDesktopTaskMode()).toBe(mode);
    }
    persistDesktopCodeWorkspace('  /tmp/taskforceai  ');

    expect(readDesktopCodeWorkspace()).toBe('/tmp/taskforceai');
  });

  it('persists normalized workspaces independently for each project', () => {
    persistDesktopProjectWorkspace(7, '  /tmp/taskforceai  ');
    persistDesktopProjectWorkspace(8, '/tmp/shared');

    expect(readDesktopProjectWorkspace(7)).toBe('/tmp/taskforceai');
    expect(readDesktopProjectWorkspace(8)).toBe('/tmp/shared');
    expect(readDesktopProjectWorkspace(null)).toBeNull();
  });

  it('ignores malformed project workspace storage', () => {
    window.localStorage.setItem('taskforceai.desktop.projects.roots.v1', '{bad json');

    expect(readDesktopProjectWorkspace(7)).toBeNull();
  });
});
