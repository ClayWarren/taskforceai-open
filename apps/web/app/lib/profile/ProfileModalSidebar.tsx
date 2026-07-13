'use client';

import React from 'react';

import { Button } from '@taskforceai/ui-kit/button';
import { cn } from '@taskforceai/ui-kit/utils';
import type { PlatformRuntime } from '../platform/platform-interfaces';
import {
  AppsIcon,
  AppshotsIcon,
  ArchivedChatsIcon,
  BrowserIcon,
  ComputerUseIcon,
  ConnectionsIcon,
  DataIcon,
  EnvironmentsIcon,
  FinanceIcon,
  GeneralIcon,
  KeyboardIcon,
  McpIcon,
  NotificationsIcon,
  PersonalizationIcon,
  SecurityIcon,
  StorageIcon,
  SubscriptionIcon,
  UsageIcon,
  WorktreesIcon,
  type ProfileTab,
} from './ProfileModalSections';

interface ProfileModalSidebarProps {
  activeTab: ProfileTab;
  onClose: () => void;
  onLogout: () => void;
  onSelectTab: (tab: ProfileTab) => void;
  platformRuntime?: PlatformRuntime;
}

type ProfileTabDefinition = {
  tab: ProfileTab;
  label: string;
  category: 'Personal' | 'Integrations' | 'Coding' | 'Account' | 'Archived';
  icon: React.ReactNode;
  desktopOnly?: boolean;
  searchText: string;
};

const profileTabDefinitions: ProfileTabDefinition[] = [
  {
    tab: 'general',
    label: 'General',
    category: 'Personal',
    icon: <GeneralIcon />,
    searchText: 'general profile account name email theme version settings',
  },
  {
    tab: 'keyboard',
    label: 'Keyboard',
    category: 'Personal',
    icon: <KeyboardIcon />,
    searchText: 'keyboard shortcuts hotkeys keys composer slash commands',
  },
  {
    tab: 'security',
    label: 'Security and login',
    category: 'Personal',
    icon: <SecurityIcon />,
    searchText: 'security login mfa multi factor authentication account password',
  },
  {
    tab: 'notifications',
    label: 'Notifications',
    category: 'Personal',
    icon: <NotificationsIcon />,
    searchText: 'notifications push alerts usage reset task updates',
  },
  {
    tab: 'personalization',
    label: 'Personalization',
    category: 'Personal',
    icon: <PersonalizationIcon />,
    searchText: 'personalization memory web search code execution trust layer preferences',
  },
  {
    tab: 'subscription',
    label: 'Subscription',
    category: 'Account',
    icon: <SubscriptionIcon />,
    searchText: 'subscription plan billing upgrade cancel reactivate credits',
  },
  {
    tab: 'usage',
    label: 'Usage',
    category: 'Account',
    icon: <UsageIcon />,
    searchText: 'usage limits messages model rates quota reset plan',
  },
  {
    tab: 'storage',
    label: 'Storage',
    category: 'Account',
    icon: <StorageIcon />,
    searchText: 'storage files images quota data space',
  },
  {
    tab: 'data',
    label: 'Data controls',
    category: 'Account',
    icon: <DataIcon />,
    searchText: 'data controls export archive delete account chats conversations',
  },
  {
    tab: 'finance',
    label: 'Finance',
    category: 'Account',
    icon: <FinanceIcon />,
    searchText: 'finance balance payment invoices billing recharge credits',
  },
  {
    tab: 'apps',
    label: 'Connected Apps',
    category: 'Integrations',
    icon: <AppsIcon />,
    searchText: 'connected apps integrations google github slack services',
  },
  {
    tab: 'mcp',
    label: 'MCP servers',
    category: 'Integrations',
    icon: <McpIcon />,
    searchText: 'mcp servers model context protocol tools prompts resources integrations',
  },
  {
    tab: 'browser',
    label: 'Browser',
    category: 'Integrations',
    icon: <BrowserIcon />,
    desktopOnly: true,
    searchText: 'browser in-app browser browser use preview webview public pages localhost',
  },
  {
    tab: 'appshots',
    label: 'Appshots',
    category: 'Integrations',
    icon: <AppshotsIcon />,
    desktopOnly: true,
    searchText: 'appshots screenshots frontmost app window capture attachments',
  },
  {
    tab: 'computer-use',
    label: 'Computer Use',
    category: 'Integrations',
    icon: <ComputerUseIcon />,
    desktopOnly: true,
    searchText: 'computer use screen control screenshot accessibility permissions local adapter',
  },
  {
    tab: 'connections',
    label: 'Connections',
    category: 'Integrations',
    icon: <ConnectionsIcon />,
    desktopOnly: true,
    searchText: 'connections remote control this mac mobile phone pairing devices keep awake',
  },
  {
    tab: 'environments',
    label: 'Environments',
    category: 'Coding',
    icon: <EnvironmentsIcon />,
    desktopOnly: true,
    searchText: 'environments local environment setup scripts actions runtime coding',
  },
  {
    tab: 'worktrees',
    label: 'Worktrees',
    category: 'Coding',
    icon: <WorktreesIcon />,
    desktopOnly: true,
    searchText: 'worktrees git branches repository workspace local coding',
  },
  {
    tab: 'archived-chats',
    label: 'Archived chats',
    category: 'Archived',
    icon: <ArchivedChatsIcon />,
    searchText: 'archived chats conversations restore delete archive history',
  },
];

const TabButton: React.FC<{
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}> = ({ active, onClick, icon, label }) => (
  <button
    onClick={onClick}
    className={cn(
      'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
      active ? 'bg-white/10 text-white' : 'text-muted-foreground hover:bg-white/5 hover:text-white'
    )}
  >
    {icon}
    {label}
  </button>
);

export function ProfileModalSidebar({
  activeTab,
  onClose,
  onLogout,
  onSelectTab,
  platformRuntime = 'browser',
}: ProfileModalSidebarProps) {
  const [query, setQuery] = React.useState('');
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const availableTabs = profileTabDefinitions.filter(
    (item) => !item.desktopOnly || platformRuntime === 'desktop'
  );
  const visibleTabs = normalizedQuery
    ? availableTabs.filter((item) =>
        `${item.label} ${item.category} ${item.searchText}`
          .toLocaleLowerCase()
          .includes(normalizedQuery)
      )
    : availableTabs;
  const categories: ProfileTabDefinition['category'][] = [
    'Personal',
    'Integrations',
    'Coding',
    'Account',
    'Archived',
  ];

  return (
    <div className="flex w-48 flex-col border-r border-border bg-black/20 p-4 sm:w-60">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-lg font-bold">Settings</h2>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-white"
          aria-label="Close"
        >
          <span className="text-2xl">×</span>
        </button>
      </div>

      <label className="sr-only" htmlFor="profile-settings-search">
        Search settings
      </label>
      <input
        id="profile-settings-search"
        aria-label="Search settings"
        className="mb-4 rounded-lg border border-border bg-black/20 px-3 py-2 text-sm text-white outline-none placeholder:text-muted-foreground focus:border-ring"
        placeholder="Search settings..."
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
        onInput={(event) => setQuery(event.currentTarget.value)}
      />

      <nav className="flex flex-1 flex-col gap-4 overflow-y-auto pr-1">
        {categories.map((category) => {
          const items = visibleTabs.filter((item) => item.category === category);
          if (items.length === 0) return null;
          return (
            <div key={category} className="space-y-1">
              <p className="px-3 text-xs font-medium text-muted-foreground">{category}</p>
              {items.map((item) => (
                <TabButton
                  key={item.tab}
                  active={activeTab === item.tab}
                  onClick={() => onSelectTab(item.tab)}
                  icon={item.icon}
                  label={item.label}
                />
              ))}
            </div>
          );
        })}
        {visibleTabs.length === 0 ? (
          <p className="px-3 text-sm text-muted-foreground">No settings found.</p>
        ) : null}
      </nav>

      <div className="mt-auto pt-4">
        <Button
          id="logout-btn"
          onClick={onLogout}
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-3 px-3 text-muted-foreground hover:bg-white/10 hover:text-white"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="size-4"
          >
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" x2="9" y1="12" y2="12" />
          </svg>
          Logout
        </Button>
      </div>
    </div>
  );
}
