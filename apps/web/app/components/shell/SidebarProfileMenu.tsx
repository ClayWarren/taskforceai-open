import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@taskforceai/ui-kit';

interface SidebarUser {
  email?: string | null;
  full_name?: string | null;
}

interface SidebarProfileMenuProps {
  hasHelpMenu: boolean;
  onClose: () => void;
  onOpenChangelog?: () => void;
  onOpenProfile: () => void;
  onOpenReportIssue?: () => void;
  user: SidebarUser | null | undefined;
}

export const SidebarProfileMenu: React.FC<SidebarProfileMenuProps> = ({
  hasHelpMenu,
  onClose,
  onOpenChangelog,
  onOpenProfile,
  onOpenReportIssue,
  user,
}) => {
  if (!user) {
    return null;
  }

  const userInitial = (user.full_name?.[0] ?? user.email?.[0] ?? 'U').toUpperCase();
  const userName = user.full_name ?? user.email?.split('@')[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          id="profile-btn"
          type="button"
          className="sidebar-profile inline-flex w-full items-center gap-3 rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-left text-slate-100"
          aria-label="Open profile menu"
          data-testid="profile-button"
        >
          <span className="sidebar-profile__avatar flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-cyan-400 text-sm font-bold text-white">
            {userInitial}
          </span>
          <div className="sidebar-profile__meta flex flex-col leading-tight">
            <span className="text-sm font-semibold text-white">{userName}</span>
            <span className="text-xs text-slate-400">View profile</span>
          </div>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        sideOffset={12}
        className="sidebar-profile-menu border border-white/15 bg-[#060a14]/95 text-slate-100 shadow-[0_18px_46px_rgba(0,0,0,0.45),0_0_22px_rgba(59,130,246,0.18)]"
      >
        <DropdownMenuLabel className="sidebar-profile-menu__label text-xs tracking-[0.12em] text-slate-400 uppercase">
          Signed in as
          <span className="block text-sm font-semibold text-white">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            onOpenProfile();
          }}
          className="dropdown-menu-item text-sm text-slate-100 focus:bg-blue-500/20 focus:text-white"
        >
          Settings
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            onOpenProfile();
          }}
          className="dropdown-menu-item text-sm text-slate-100 focus:bg-blue-500/20 focus:text-white"
        >
          Upgrade plan
        </DropdownMenuItem>
        {hasHelpMenu ? (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="dropdown-menu-subtrigger text-sm text-slate-100 focus:bg-blue-500/20 focus:text-white data-[state=open]:bg-blue-500/20 data-[state=open]:text-white">
              Help
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="sidebar-profile-menu border border-white/15 bg-[#060a14]/95 text-slate-100 shadow-[0_18px_46px_rgba(0,0,0,0.45),0_0_22px_rgba(59,130,246,0.18)]">
              {onOpenReportIssue ? (
                <DropdownMenuItem
                  onSelect={(event) => {
                    event.preventDefault();
                    onOpenReportIssue();
                    onClose();
                  }}
                  className="dropdown-menu-item text-sm text-slate-100 focus:bg-blue-500/20 focus:text-white"
                >
                  Report issue
                </DropdownMenuItem>
              ) : null}
              {onOpenChangelog ? (
                <DropdownMenuItem
                  onSelect={(event) => {
                    event.preventDefault();
                    onOpenChangelog();
                    onClose();
                  }}
                  className="dropdown-menu-item text-sm text-slate-100 focus:bg-blue-500/20 focus:text-white"
                >
                  Changelog
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
