import { afterEach, describe, expect, it, vi } from 'bun:test';

import '../../../../../tests/setup/dom';

import {
  bindingFromKeyboardEvent,
  defaultDesktopCommandBindings,
  desktopBindingMatches,
  DESKTOP_COMMAND_BINDINGS_CHANGED_EVENT,
  displayDesktopBinding,
  persistDesktopCommandBinding,
  readDesktopCommandBindings,
  resetDesktopCommandBindings,
} from './desktop-command-bindings';

describe('desktop command bindings', () => {
  afterEach(() => window.localStorage.clear());

  it('normalizes platform modifiers and provides defaults during SSR', () => {
    const event = {
      key: 'p',
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: true,
    } as KeyboardEvent;
    expect(bindingFromKeyboardEvent(event)).toBe('Mod+Shift+P');
    expect(desktopBindingMatches('Mod+Shift+P', event)).toBe(true);
    expect(readDesktopCommandBindings()['palette.open']).toBe('Mod+Shift+P');
    expect(readDesktopCommandBindings()['task.previous']).toBe('Alt+ArrowUp');
    expect(readDesktopCommandBindings()['task.next']).toBe('Alt+ArrowDown');
  });

  it('loads valid persisted overrides and ignores malformed preferences', () => {
    window.localStorage.setItem(
      'taskforceai.desktop.command-bindings.v1',
      JSON.stringify({ 'task.new': 'Mod+Shift+N', 'task.search': '', 'mode.chat': 42 })
    );
    expect(readDesktopCommandBindings()['task.new']).toBe('Mod+Shift+N');
    expect(readDesktopCommandBindings()['task.search']).toBe('Mod+K');
    expect(readDesktopCommandBindings()['mode.chat']).toBe('Mod+1');

    window.localStorage.setItem('taskforceai.desktop.command-bindings.v1', '{bad json');
    expect(readDesktopCommandBindings()).toEqual(defaultDesktopCommandBindings());
  });

  it('persists and resets bindings while notifying desktop listeners', () => {
    const listener = vi.fn();
    window.addEventListener(DESKTOP_COMMAND_BINDINGS_CHANGED_EVENT, listener);

    persistDesktopCommandBinding('mode.code', 'Mod+9');
    expect(readDesktopCommandBindings()['mode.code']).toBe('Mod+9');
    resetDesktopCommandBindings();
    expect(readDesktopCommandBindings()['mode.code']).toBe('Mod+3');
    expect(listener).toHaveBeenCalledTimes(2);

    window.removeEventListener(DESKTOP_COMMAND_BINDINGS_CHANGED_EVENT, listener);
  });

  it('normalizes special keys, modifiers, and display labels', () => {
    const keyboardEvent = (overrides: Partial<KeyboardEvent>) =>
      ({
        key: ' ',
        metaKey: false,
        ctrlKey: true,
        altKey: true,
        shiftKey: false,
        ...overrides,
      }) as KeyboardEvent;

    expect(bindingFromKeyboardEvent(keyboardEvent({}))).toBe('Mod+Alt+Space');
    expect(bindingFromKeyboardEvent(keyboardEvent({ key: 'Shift' }))).toBeNull();
    expect(displayDesktopBinding('Mod+Shift+P')).toMatch(/^(?:⌘|Ctrl) Shift P$/);
  });
});
