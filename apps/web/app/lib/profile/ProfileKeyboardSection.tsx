'use client';

const keyboardShortcutGroups = [
  {
    title: 'Composer',
    shortcuts: [
      { action: 'Send message', keys: ['Enter'] },
      { action: 'Add a new line', keys: ['Shift', 'Enter'] },
      { action: 'Start dictation in the web app', keys: ['Ctrl', 'Shift', 'D'] },
      { action: 'Start realtime voice in the web app', keys: ['Ctrl', 'Shift', 'V'] },
      { action: 'Select model in the web app', keys: ['Ctrl', 'Shift', 'M'] },
      { action: 'Start dictation in the desktop app', keys: ['Ctrl', 'M'] },
    ],
  },
  {
    title: 'Slash commands',
    shortcuts: [
      { action: 'Accept suggestion', keys: ['Tab'] },
      { action: 'Accept suggestion', keys: ['Enter'] },
      { action: 'Move through suggestions', keys: ['Up/Down'] },
    ],
  },
  {
    title: 'Overlays',
    shortcuts: [{ action: 'Close the active overlay', keys: ['Esc'] }],
  },
] as const;

export function KeyboardShortcutsSection() {
  return (
    <div className="space-y-6">
      <p className="max-w-xl text-sm leading-6 text-muted-foreground">
        Current keyboard shortcuts. Custom keybindings can be added once shortcuts are centralized.
      </p>

      <div className="divide-y divide-border border-y border-border">
        {keyboardShortcutGroups.map((group) => (
          <section key={group.title} aria-labelledby={`keyboard-${group.title.toLowerCase()}`}>
            <h4
              id={`keyboard-${group.title.toLowerCase()}`}
              className="pt-5 pb-3 text-sm font-semibold text-foreground"
            >
              {group.title}
            </h4>
            <div className="space-y-1 pb-5">
              {group.shortcuts.map((shortcut) => (
                <div
                  key={`${group.title}-${shortcut.action}-${shortcut.keys.join('-')}`}
                  className="flex items-center justify-between gap-4 rounded-md px-1 py-2"
                >
                  <span className="text-sm text-muted-foreground">{shortcut.action}</span>
                  <span
                    className="flex shrink-0 items-center gap-1.5"
                    aria-label={shortcut.keys.join(' ')}
                  >
                    {shortcut.keys.map((key) => (
                      <kbd
                        key={key}
                        className="rounded border border-border bg-muted px-2 py-1 font-mono text-xs font-medium text-foreground shadow-sm"
                      >
                        {key}
                      </kbd>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
