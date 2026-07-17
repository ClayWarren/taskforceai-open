import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'bun:test';

import '../../../../../tests/setup/dom';
import {
  configureDesktopUi,
  DesktopAgentManagerPanel,
  DesktopAuthButtons,
  DesktopBrowserPanel,
  DesktopCodePinnedSummary,
  DesktopCodeWorkspaceSurface,
  DesktopCompanion,
  DesktopProjectsSidebar,
  DesktopTerminalPanel,
  DesktopUpdateButton,
  DesktopWorkspaceMentionMenu,
  DesktopWorkspaceTargetSelector,
  type DesktopUiIntegration,
  WorkspaceFileTreePanel,
} from './desktop-ui';

describe('desktop UI integration facade', () => {
  it('renders configured desktop components with their forwarded props', () => {
    const component = (name: string) => (props: Record<string, unknown>) => (
      <div data-testid={name} data-props={Object.keys(props).toSorted().join(',')} />
    );
    configureDesktopUi({
      AgentManagerPanel: component('agent-manager'),
      AuthButtons: component('auth-buttons'),
      BrowserPanel: component('browser-panel'),
      CodePinnedSummary: component('code-summary'),
      CodeWorkspaceSurface: component('code-workspace'),
      Companion: component('companion'),
      ProjectsSidebar: component('projects-sidebar'),
      TerminalPanel: component('terminal-panel'),
      UpdateButton: component('update-button'),
      WorkspaceMentionMenu: component('workspace-mention-menu'),
      WorkspaceTargetSelector: component('workspace-target-selector'),
      WorkspaceFileTreePanel: component('file-tree'),
    } as unknown as DesktopUiIntegration);

    render(
      <>
        <DesktopAgentManagerPanel open taskMode="code" onClose={vi.fn()} />
        <DesktopAuthButtons onSignIn={vi.fn()} />
        <DesktopBrowserPanel open onClose={vi.fn()} />
        <DesktopCodePinnedSummary
          sources={[]}
          onOpenEnvironment={vi.fn()}
          onReviewChanges={vi.fn()}
        />
        <DesktopCodeWorkspaceSurface
          open
          view="review"
          onOpenChange={vi.fn()}
          onViewChange={vi.fn()}
        />
        <DesktopCompanion pet={null} />
        <DesktopProjectsSidebar mode="code" searchQuery="query" onClose={vi.fn()} />
        <DesktopTerminalPanel open onClose={vi.fn()} />
        <DesktopUpdateButton
          desktopUpdateVersion="1.2.3"
          desktopUpdateAction="idle"
          onCheckForUpdates={vi.fn()}
        />
        <DesktopWorkspaceMentionMenu query="src" onSelect={vi.fn()} />
        <DesktopWorkspaceTargetSelector projectId={7} />
        <WorkspaceFileTreePanel isOpen onClose={vi.fn()} />
      </>
    );

    for (const testId of [
      'agent-manager',
      'auth-buttons',
      'browser-panel',
      'code-summary',
      'code-workspace',
      'companion',
      'projects-sidebar',
      'terminal-panel',
      'update-button',
      'workspace-mention-menu',
      'workspace-target-selector',
      'file-tree',
    ]) {
      expect(screen.getByTestId(testId)).toBeInTheDocument();
    }
  });
});
