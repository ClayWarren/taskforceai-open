'use client';

import React from 'react';

import { Button } from '@taskforceai/ui-kit';
import { cn } from '../../../lib/utils';
import {
  AppsIcon,
  DataIcon,
  FinanceIcon,
  GeneralIcon,
  KeyboardIcon,
  NotificationsIcon,
  PersonalizationIcon,
  SecurityIcon,
  StorageIcon,
  SubscriptionIcon,
  type ProfileTab,
} from './ProfileModalSections';

interface ProfileModalSidebarProps {
  activeTab: ProfileTab;
  onClose: () => void;
  onLogout: () => void;
  onSelectTab: (tab: ProfileTab) => void;
}

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
}: ProfileModalSidebarProps) {
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

      <nav className="flex flex-1 flex-col gap-1">
        <TabButton
          active={activeTab === 'general'}
          onClick={() => onSelectTab('general')}
          icon={<GeneralIcon />}
          label="General"
        />
        <TabButton
          active={activeTab === 'keyboard'}
          onClick={() => onSelectTab('keyboard')}
          icon={<KeyboardIcon />}
          label="Keyboard"
        />
        <TabButton
          active={activeTab === 'security'}
          onClick={() => onSelectTab('security')}
          icon={<SecurityIcon />}
          label="Security and login"
        />
        <TabButton
          active={activeTab === 'notifications'}
          onClick={() => onSelectTab('notifications')}
          icon={<NotificationsIcon />}
          label="Notifications"
        />
        <TabButton
          active={activeTab === 'personalization'}
          onClick={() => onSelectTab('personalization')}
          icon={<PersonalizationIcon />}
          label="Personalization"
        />
        <TabButton
          active={activeTab === 'subscription'}
          onClick={() => onSelectTab('subscription')}
          icon={<SubscriptionIcon />}
          label="Subscription"
        />
        <TabButton
          active={activeTab === 'storage'}
          onClick={() => onSelectTab('storage')}
          icon={<StorageIcon />}
          label="Storage"
        />
        <TabButton
          active={activeTab === 'data'}
          onClick={() => onSelectTab('data')}
          icon={<DataIcon />}
          label="Data controls"
        />
        <TabButton
          active={activeTab === 'finance'}
          onClick={() => onSelectTab('finance')}
          icon={<FinanceIcon />}
          label="Finance"
        />
        <TabButton
          active={activeTab === 'apps'}
          onClick={() => onSelectTab('apps')}
          icon={<AppsIcon />}
          label="Connected Apps"
        />
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
