export type DesktopCommandId =
  | 'palette.open'
  | 'task.new'
  | 'task.search'
  | 'task.previous'
  | 'task.next'
  | 'settings.open'
  | 'sidebar.toggle'
  | 'mode.chat'
  | 'mode.work'
  | 'mode.code'
  | 'code.files'
  | 'code.terminal'
  | 'code.workspace';

export type DesktopCommandScope = 'all' | 'code';

export type DesktopCommandDescriptor = {
  id: DesktopCommandId;
  label: string;
  group: string;
  scope: DesktopCommandScope;
  defaultBinding: string;
};

export const DESKTOP_COMMANDS: readonly DesktopCommandDescriptor[] = [
  {
    id: 'palette.open',
    label: 'Open command palette',
    group: 'General',
    scope: 'all',
    defaultBinding: 'Mod+Shift+P',
  },
  { id: 'task.new', label: 'New task', group: 'Tasks', scope: 'all', defaultBinding: 'Mod+N' },
  {
    id: 'task.search',
    label: 'Search tasks',
    group: 'Tasks',
    scope: 'all',
    defaultBinding: 'Mod+K',
  },
  {
    id: 'task.previous',
    label: 'Previous task',
    group: 'Tasks',
    scope: 'all',
    defaultBinding: 'Alt+ArrowUp',
  },
  {
    id: 'task.next',
    label: 'Next task',
    group: 'Tasks',
    scope: 'all',
    defaultBinding: 'Alt+ArrowDown',
  },
  {
    id: 'settings.open',
    label: 'Open settings',
    group: 'General',
    scope: 'all',
    defaultBinding: 'Mod+,',
  },
  {
    id: 'sidebar.toggle',
    label: 'Toggle sidebar',
    group: 'General',
    scope: 'all',
    defaultBinding: 'Mod+B',
  },
  {
    id: 'mode.chat',
    label: 'Switch to Chat',
    group: 'Modes',
    scope: 'all',
    defaultBinding: 'Mod+1',
  },
  {
    id: 'mode.work',
    label: 'Switch to Work',
    group: 'Modes',
    scope: 'all',
    defaultBinding: 'Mod+2',
  },
  {
    id: 'mode.code',
    label: 'Switch to Code',
    group: 'Modes',
    scope: 'all',
    defaultBinding: 'Mod+3',
  },
  {
    id: 'code.files',
    label: 'Open workspace files',
    group: 'Code',
    scope: 'code',
    defaultBinding: 'Mod+Shift+E',
  },
  {
    id: 'code.terminal',
    label: 'Toggle terminal',
    group: 'Code',
    scope: 'code',
    defaultBinding: 'Mod+`',
  },
  {
    id: 'code.workspace',
    label: 'Open code workspace',
    group: 'Code',
    scope: 'code',
    defaultBinding: 'Mod+Shift+W',
  },
] as const;

const STORAGE_KEY = 'taskforceai.desktop.command-bindings.v1';
export const DESKTOP_COMMAND_BINDINGS_CHANGED_EVENT =
  'taskforceai:desktop-command-bindings-changed';

export type DesktopCommandBindings = Record<DesktopCommandId, string>;

export const defaultDesktopCommandBindings = (): DesktopCommandBindings =>
  Object.fromEntries(
    DESKTOP_COMMANDS.map((command) => [command.id, command.defaultBinding])
  ) as DesktopCommandBindings;

export const readDesktopCommandBindings = (): DesktopCommandBindings => {
  const defaults = defaultDesktopCommandBindings();
  if (typeof window === 'undefined') return defaults;
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<
      string,
      unknown
    >; // coverage-ignore-line -- type-only generic close
    for (const command of DESKTOP_COMMANDS) {
      const binding = stored[command.id];
      if (typeof binding === 'string' && binding) {
        defaults[command.id] = binding;
      }
    }
  } catch {
    // Ignore malformed preferences and keep defaults.
  }
  return defaults;
};

export const persistDesktopCommandBinding = (id: DesktopCommandId, binding: string): void => {
  if (typeof window === 'undefined') return;
  const next = { ...readDesktopCommandBindings(), [id]: binding };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(DESKTOP_COMMAND_BINDINGS_CHANGED_EVENT));
};

export const resetDesktopCommandBindings = (): void => {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new CustomEvent(DESKTOP_COMMAND_BINDINGS_CHANGED_EVENT));
};

const normalizedEventKey = (event: KeyboardEvent | React.KeyboardEvent): string => {
  if (event.key === ' ') return 'Space';
  return event.key.length === 1 ? event.key.toUpperCase() : event.key;
};

export const bindingFromKeyboardEvent = (
  event: KeyboardEvent | React.KeyboardEvent
): string | null => {
  if (['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return null;
  const parts: string[] = [];
  if (event.metaKey || event.ctrlKey) parts.push('Mod');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  parts.push(normalizedEventKey(event));
  return parts.join('+');
};

export const desktopBindingMatches = (
  binding: string,
  event: KeyboardEvent | React.KeyboardEvent
): boolean => bindingFromKeyboardEvent(event) === binding;

export const displayDesktopBinding = (binding: string): string =>
  binding
    .replace(
      'Mod',
      typeof navigator !== 'undefined' && /Mac/.test(navigator.platform) ? '⌘' : 'Ctrl'
    )
    .replaceAll('+', ' ');
