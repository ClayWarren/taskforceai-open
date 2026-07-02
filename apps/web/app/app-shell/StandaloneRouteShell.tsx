'use client';

import type { ConversationSummary } from '@taskforceai/contracts/contracts';
import { writeStorageItem } from '@taskforceai/shared/utils/browser-storage';
import clsx from 'clsx';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';

import Sidebar from '../components/shell/Sidebar';
import { useRouter } from '../components/routing';
import { useProfileModal } from '../lib/profile/ProfileModalContext';
import { useAuth } from '../lib/providers/AuthProvider';
import { CollapsedSidebar } from './CollapsedSidebar';
import { MobileHamburgerIcon } from './icons';

interface StandaloneRouteShellProps {
  children: ReactNode;
}

const ACTIVE_CONVERSATION_KEY = 'activeConversationId';

function rememberActiveConversation(conversation: ConversationSummary) {
  if (typeof window === 'undefined' || typeof conversation.model !== 'string') {
    return;
  }
  writeStorageItem(ACTIVE_CONVERSATION_KEY, conversation.model);
}

export function StandaloneRouteShell({ children }: StandaloneRouteShellProps) {
  const router = useRouter();
  const { isAuthenticated } = useAuth();
  const { open: openProfileModal } = useProfileModal();
  const [hasMounted, setHasMounted] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  useEffect(() => {
    setHasMounted(true);
  }, []);

  const navigateHome = useCallback(() => {
    setIsSidebarOpen(false);
    void router.navigate({ to: '/' });
  }, [router]);

  const handleConversationSelect = useCallback(
    (conversation: ConversationSummary) => {
      rememberActiveConversation(conversation);
      navigateHome();
    },
    [navigateHome]
  );

  const handleOpenProfile = useCallback(() => {
    if (!isAuthenticated) {
      return;
    }
    openProfileModal({
      onOpen: () => {
        setIsSidebarOpen(false);
      },
    });
  }, [isAuthenticated, openProfileModal]);

  return (
    <div
      className={clsx(
        'app-container relative flex min-h-screen text-slate-100',
        'bg-[linear-gradient(180deg,#050915_0%,#060814_42%,#04060f_100%)]'
      )}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            'radial-gradient(1100px at 18% 12%, rgba(59,130,246,0.2), transparent 55%), radial-gradient(900px at 78% 78%, rgba(14,165,233,0.16), transparent 52%)',
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background: 'radial-gradient(1200px at 50% 72%, rgba(30,64,175,0.24), transparent 62%)',
        }}
      />

      {hasMounted ? (
        <>
          <CollapsedSidebar
            isSidebarOpen={isSidebarOpen}
            isAuthenticated={isAuthenticated}
            shouldShowNewChatShortcut={isAuthenticated}
            onLogoClick={navigateHome}
            onNewChat={navigateHome}
            onSearchClick={() => setIsSidebarOpen(true)}
            onOpenSidebar={() => setIsSidebarOpen(true)}
            onOpenProfile={handleOpenProfile}
          />

          <Sidebar
            isOpen={isSidebarOpen}
            onClose={() => setIsSidebarOpen(false)}
            onNewChat={navigateHome}
            onConversationSelect={handleConversationSelect}
          />

          <div className="fixed top-4 left-4 z-[250] md:hidden">
            <button
              type="button"
              className="mobile-hero__hamburger"
              onClick={() => setIsSidebarOpen(true)}
              aria-label="Open sidebar"
            >
              <MobileHamburgerIcon />
            </button>
          </div>
        </>
      ) : null}

      <div
        className={clsx(
          'main-content relative flex min-h-screen flex-1 justify-center overflow-auto px-4 pt-14 pb-12 transition duration-150 md:pt-0 md:pr-8',
          isSidebarOpen ? 'md:pl-[20rem] lg:pl-[22rem]' : 'md:pl-32 lg:pl-40',
          isSidebarOpen && 'md:brightness-[0.94]'
        )}
      >
        <main className="w-full">{children}</main>
      </div>
    </div>
  );
}
