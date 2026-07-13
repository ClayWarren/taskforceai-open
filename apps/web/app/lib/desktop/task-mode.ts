export type DesktopTaskMode = 'chat' | 'work' | 'code';

const DESKTOP_TASK_MODE_STORAGE_KEY = 'taskforceai.desktop.task-mode.v1';
const DESKTOP_CODE_WORKSPACE_STORAGE_KEY = 'taskforceai.desktop.code-workspace.v1';
const DESKTOP_CODE_WORKSPACE_ROOTS_STORAGE_KEY = 'taskforceai.desktop.code-workspace-roots.v2';

const isDesktopTaskMode = (value: string | null): value is DesktopTaskMode =>
  value === 'chat' || value === 'work' || value === 'code';

export const readDesktopTaskMode = (): DesktopTaskMode => {
  if (typeof window === 'undefined') return 'chat';
  const stored = window.localStorage.getItem(DESKTOP_TASK_MODE_STORAGE_KEY);
  return isDesktopTaskMode(stored) ? stored : 'chat';
};

export const persistDesktopTaskMode = (mode: DesktopTaskMode): void => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(DESKTOP_TASK_MODE_STORAGE_KEY, mode);
};

export const readDesktopCodeWorkspace = (): string | null => {
  if (typeof window === 'undefined') return null;
  const workspace = window.localStorage.getItem(DESKTOP_CODE_WORKSPACE_STORAGE_KEY)?.trim();
  return workspace || null;
};

export const readDesktopCodeWorkspaceRoots = (): string[] => {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(DESKTOP_CODE_WORKSPACE_ROOTS_STORAGE_KEY) ?? '[]'
    );
    if (Array.isArray(parsed)) {
      const roots = parsed
        .filter((root): root is string => typeof root === 'string')
        .map((root) => root.trim())
        .filter(Boolean);
      if (roots.length) return [...new Set(roots)];
    }
  } catch {
    // Ignore malformed local storage and fall back to the legacy primary root.
  }
  const legacy = readDesktopCodeWorkspace();
  return legacy ? [legacy] : [];
};

export const persistDesktopCodeWorkspace = (workspace: string): void => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(DESKTOP_CODE_WORKSPACE_STORAGE_KEY, workspace.trim());
};

export const persistDesktopCodeWorkspaceRoots = (roots: string[]): void => {
  if (typeof window === 'undefined') return;
  const normalized = [...new Set(roots.map((root) => root.trim()).filter(Boolean))];
  window.localStorage.setItem(DESKTOP_CODE_WORKSPACE_ROOTS_STORAGE_KEY, JSON.stringify(normalized));
  if (normalized[0]) persistDesktopCodeWorkspace(normalized[0]);
};
