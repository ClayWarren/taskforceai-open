'use client';

import { lazy, Suspense } from 'react';

import type { ToolUsageEvent } from '../../lib/types';
import type { DesktopTaskMode } from '../../lib/desktop/task-mode';
import { DesktopAgentManagerPanel } from '../../lib/platform/desktop-ui';

const ShareModal = lazy(() => import('../../components/chat/ShareModal'));
const QuickSearchDialog = lazy(() =>
  import('../../components/modals/QuickSearchDialog').then((m) => ({
    default: m.QuickSearchDialog,
  }))
);
const ReportIssueModal = lazy(() => import('../../components/modals/ReportIssueModal'));
const ComputerTheater = lazy(() =>
  import('../../components/chat/ComputerTheater').then((m) => ({
    default: m.ComputerTheater,
  }))
);
export interface QuickSearchRecord {
  conversationId: string;
  updatedAt: number | string;
  title?: string;
  lastMessagePreview?: string | null;
}

export interface AppShellOverlaysProps {
  computerUseEnabled: boolean;
  isStreaming: boolean;
  useLoggedInServices: boolean;
  toolEvents: ToolUsageEvent[];
  preScreenStatus?: string | null;
  isReportIssueOpen: boolean;
  onReportIssueOpenChange: (_open: boolean) => void;
  reportIssueContext: {
    conversationId?: string | null;
    lastMessagePreview?: string;
  };
  isQuickSearchOpen: boolean;
  isAuthenticated: boolean;
  onCloseQuickSearch: () => void;
  onNewChat: () => void;
  onQuickSearchSelect: (_record: QuickSearchRecord) => void | Promise<void>;
  remoteConversationId: number | null;
  isShareModalOpen: boolean;
  onCloseShareModal: () => void;
  isAgentManagerOpen: boolean;
  onCloseAgentManager: () => void;
  desktopTaskMode: DesktopTaskMode;
  desktopRuntime: boolean;
  initialIsPublic?: boolean;
  initialShareId?: string;
}

export function AppShellOverlays(props: AppShellOverlaysProps) {
  return (
    <>
      {props.computerUseEnabled && props.isStreaming && (
        <Suspense fallback={null}>
          <ComputerTheater
            toolEvents={props.toolEvents}
            isStreaming={props.isStreaming}
            useLoggedInServices={props.useLoggedInServices}
            autoExpand={true}
            showWhenEmpty={true}
            preScreenStatus={props.preScreenStatus}
            recordReplayEnabled={props.desktopRuntime}
          />
        </Suspense>
      )}

      <Suspense fallback={null}>
        <ReportIssueModal
          open={props.isReportIssueOpen}
          onOpenChange={props.onReportIssueOpenChange}
          context={props.reportIssueContext}
        />
      </Suspense>

      <Suspense fallback={null}>
        <QuickSearchDialog
          isOpen={props.isQuickSearchOpen}
          isAuthenticated={props.isAuthenticated}
          onClose={props.onCloseQuickSearch}
          onNewChat={props.onNewChat}
          onSelect={props.onQuickSearchSelect}
        />
      </Suspense>

      {props.remoteConversationId !== null && (
        <Suspense fallback={null}>
          <ShareModal
            isOpen={props.isShareModalOpen}
            onClose={props.onCloseShareModal}
            conversationId={props.remoteConversationId}
            initialIsPublic={props.initialIsPublic}
            initialShareId={props.initialShareId}
          />
        </Suspense>
      )}

      <Suspense fallback={null}>
        <DesktopAgentManagerPanel
          open={props.isAgentManagerOpen}
          onClose={props.onCloseAgentManager}
          taskMode={props.desktopTaskMode}
        />
      </Suspense>
    </>
  );
}
