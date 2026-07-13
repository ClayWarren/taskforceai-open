import { beforeEach, describe, expect, it } from 'bun:test';

import '../../../../../tests/setup/dom';
import {
  persistDesktopCodeWorkspace,
  persistDesktopCodeWorkspaceRoots,
  persistDesktopTaskMode,
  readDesktopCodeWorkspace,
  readDesktopCodeWorkspaceRoots,
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

  it('persists the selected mode and normalized Code workspace', () => {
    persistDesktopTaskMode('work');
    persistDesktopCodeWorkspace('  /tmp/taskforceai  ');

    expect(readDesktopTaskMode()).toBe('work');
    expect(readDesktopCodeWorkspace()).toBe('/tmp/taskforceai');
  });
});
