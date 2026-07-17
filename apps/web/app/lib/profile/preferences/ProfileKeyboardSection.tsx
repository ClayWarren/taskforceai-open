'use client';

import { useEffect, useState } from 'react';

import {
  DESKTOP_COMMANDS,
  DESKTOP_COMMAND_BINDINGS_CHANGED_EVENT,
  bindingFromKeyboardEvent,
  displayDesktopBinding,
  persistDesktopCommandBinding,
  readDesktopCommandBindings,
  resetDesktopCommandBindings,
  type DesktopCommandId,
} from '../../commands/desktop-command-bindings';

const fixedShortcutGroups = [
  {
    title: 'Composer',
    shortcuts: [
      { action: 'Send message', keys: 'Enter' },
      { action: 'Add a new line', keys: 'Shift Enter' },
      { action: 'Accept suggestion', keys: 'Tab' },
    ],
  },
  {
    title: 'Slash commands',
    shortcuts: [
      { action: 'Accept suggestion', keys: 'Tab' },
      { action: 'Accept suggestion', keys: 'Enter' },
      { action: 'Move through suggestions', keys: 'Up/Down' },
    ],
  },
  {
    title: 'Overlays',
    shortcuts: [{ action: 'Close the active overlay', keys: 'Esc' }],
  },
] as const;

export function KeyboardShortcutsSection() {
  const [bindings, setBindings] = useState(readDesktopCommandBindings);
  const [recording, setRecording] = useState<DesktopCommandId | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);

  useEffect(() => {
    const refresh = () => setBindings(readDesktopCommandBindings());
    window.addEventListener(DESKTOP_COMMAND_BINDINGS_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(DESKTOP_COMMAND_BINDINGS_CHANGED_EVENT, refresh);
  }, []);

  const record = (id: DesktopCommandId, event: React.KeyboardEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (event.key === 'Escape') {
      setRecording(null);
      return;
    }
    const binding = bindingFromKeyboardEvent(event);
    if (!binding) return;
    const duplicate = DESKTOP_COMMANDS.find(
      (command) => command.id !== id && bindings[command.id] === binding
    );
    if (duplicate) {
      setConflict(`${displayDesktopBinding(binding)} is already assigned to ${duplicate.label}.`);
      return;
    }
    persistDesktopCommandBinding(id, binding);
    setBindings(readDesktopCommandBindings());
    setConflict(null);
    setRecording(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <p className="max-w-xl text-sm leading-6 text-muted-foreground">
          Click a desktop command shortcut, then press the replacement key combination.
        </p>
        <button
          type="button"
          className="shrink-0 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={() => {
            resetDesktopCommandBindings();
            setBindings(readDesktopCommandBindings());
            setConflict(null);
          }}
        >
          Reset
        </button>
      </div>
      {conflict ? <p className="text-sm text-destructive">{conflict}</p> : null}

      <section className="border-y border-border" aria-labelledby="keyboard-desktop-commands">
        <h4
          id="keyboard-desktop-commands"
          className="pt-5 pb-3 text-sm font-semibold text-foreground"
        >
          Desktop commands
        </h4>
        <div className="space-y-1 pb-5">
          {DESKTOP_COMMANDS.map((command) => (
            <div
              key={command.id}
              className="flex items-center justify-between gap-4 rounded-md px-1 py-2"
            >
              <span>
                <span className="block text-sm text-muted-foreground">{command.label}</span>
                {command.scope === 'code' ? (
                  <span className="block text-xs text-muted-foreground/70">Code only</span>
                ) : null}
              </span>
              <button
                type="button"
                className="rounded border border-border bg-muted px-2 py-1 font-mono text-xs font-medium text-foreground shadow-sm focus:ring-2 focus:ring-ring focus:outline-none"
                onClick={() => setRecording(command.id)}
                onKeyDown={(event) => recording === command.id && record(command.id, event)}
              >
                {recording === command.id
                  ? 'Press shortcut…'
                  : displayDesktopBinding(bindings[command.id])}
              </button>
            </div>
          ))}
        </div>
      </section>

      {fixedShortcutGroups.map((group) => (
        <section key={group.title} className="border-b border-border pb-5">
          <h4 className="pb-3 text-sm font-semibold text-foreground">{group.title}</h4>
          {group.shortcuts.map((shortcut) => (
            <div
              key={`${shortcut.action}-${shortcut.keys}`}
              className="flex items-center justify-between gap-4 px-1 py-2"
            >
              <span className="text-sm text-muted-foreground">{shortcut.action}</span>
              <kbd className="rounded border border-border bg-muted px-2 py-1 font-mono text-xs font-medium text-foreground shadow-sm">
                {shortcut.keys}
              </kbd>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
