import { mock } from 'bun:test';
import React from 'react';

type ChildrenProps = {
  children?: React.ReactNode;
};

const Passthrough = ({ children }: ChildrenProps) => <>{children}</>;

export const installWebBunComponentMocks = () => {
  mock.module('@radix-ui/react-slot', () => ({
    Slot: Passthrough,
    Slottable: Passthrough,
    createSlottable: () => Passthrough,
  }));

  mock.module('@radix-ui/react-dialog', () => ({
    Root: Passthrough,
    Trigger: Passthrough,
    Portal: Passthrough,
    Overlay: Passthrough,
    Content: Passthrough,
    Title: Passthrough,
    Description: Passthrough,
    Close: Passthrough,
    createDialogScope: () => [() => ({}), () => ({}), () => ({}), () => ({})],
  }));

  mock.module('@radix-ui/react-popover', () => ({
    Root: Passthrough,
    Trigger: Passthrough,
    Portal: Passthrough,
    Content: Passthrough,
    Anchor: Passthrough,
  }));

  mock.module('@radix-ui/react-tooltip', () => ({
    Provider: Passthrough,
    Root: Passthrough,
    Trigger: Passthrough,
    Portal: Passthrough,
    Content: Passthrough,
  }));

  mock.module('@taskforceai/ui-kit', () => ({
    Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
    Input: (props: any) => <input {...props} />,
    Textarea: (props: any) => <textarea {...props} />,
    Badge: ({ children }: any) => <span>{children}</span>,
    Separator: () => <hr />,
    Switch: ({ checked, onCheckedChange, ...props }: any) => (
      <button
        type="button"
        aria-pressed={Boolean(checked)}
        onClick={() => onCheckedChange?.(!checked)}
        {...props}
      />
    ),
    QueryProvider: Passthrough,
    SyncProvider: Passthrough,
    useSync: () => ({ isOnline: true }),
    DropdownMenu: Passthrough,
    DropdownMenuTrigger: Passthrough,
    DropdownMenuContent: Passthrough,
    DropdownMenuLabel: Passthrough,
    DropdownMenuSeparator: () => <hr />,
    DropdownMenuSub: Passthrough,
    DropdownMenuSubContent: Passthrough,
    DropdownMenuSubTrigger: ({ children }: any) => <button type="button">{children}</button>,
    DropdownMenuCheckboxItem: ({ children, checked, onCheckedChange }: any) => (
      <button
        type="button"
        aria-pressed={Boolean(checked)}
        onClick={() => onCheckedChange?.(!checked)}
      >
        {children}
      </button>
    ),
    DropdownMenuItem: ({ children, onSelect }: any) => (
      <button type="button" onClick={() => onSelect?.({ preventDefault: () => undefined })}>
        {children}
      </button>
    ),
    TooltipProvider: Passthrough,
    Tooltip: Passthrough,
    TooltipTrigger: Passthrough,
    TooltipContent: Passthrough,
    Popover: Passthrough,
    PopoverTrigger: Passthrough,
    PopoverContent: Passthrough,
    PopoverAnchor: Passthrough,
    Dialog: ({ children, open }: any) => (open ? <div>{children}</div> : null),
    DialogContent: Passthrough,
    DialogHeader: Passthrough,
    DialogTitle: Passthrough,
    DialogDescription: Passthrough,
    applyThemePreference: () => ({ ok: true, value: true }),
    readStoredThemePreference: () => ({ ok: true, value: 'system' }),
    readSystemThemePreference: () => 'light',
    resolveInitialThemePreference: () => 'system',
    clearThemePreference: () => ({ ok: true, value: true }),
    subscribeToSystemTheme: () => ({ ok: true, value: () => undefined }),
    cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' '),
  }));
};
