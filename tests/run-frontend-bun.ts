import path from 'path';

import {
  argsAfterScript,
  cleanCoverageArgs,
  collectTestFiles,
  normalizePositiveInt,
  runFilesWithDots,
  runLcovCoverage,
  selectShard,
} from './test-runner';

type TestScope = 'all' | 'app' | 'marketing' | 'admin' | 'console' | 'status';

const SCOPE_TEST_PATTERNS: Record<TestScope, string[]> = {
  app: [
    'apps/desktop/ui/**/*.{test,spec}.{ts,tsx}',
    'apps/web/app/(product)/**/*.{test,spec}.{ts,tsx}',
    'apps/web/app/(admin)/**/*.{test,spec}.{ts,tsx}',
    'apps/web/app/(auth)/**/*.{test,spec}.{ts,tsx}',
    'apps/web/app/app-shell/**/*.{test,spec}.{ts,tsx}',
    'apps/web/app/components/chat/**/*.{test,spec}.{ts,tsx}',
    'apps/web/app/components/modals/**/*.{test,spec}.{ts,tsx}',
    'apps/web/app/components/shell/**/*.{test,spec}.{ts,tsx}',
    'apps/web/app/components/tool-usage/**/*.{test,spec}.{ts,tsx}',
    'apps/web/app/components/markdown/**/*.{test,spec}.{ts,tsx}',
    'apps/web/app/components/ui/**/*.{test,spec}.{ts,tsx}',
    'apps/web/app/components/admin/**/*.{test,spec}.{ts,tsx}',
    'apps/web/app/lib/**/*.{test,spec}.{ts,tsx}',
    'apps/web/app/__tests__/**/*.{test,spec}.{ts,tsx}',
    'apps/web/app/routes/**/*.{test,spec}.{ts,tsx}',
    'apps/web/lib/**/*.{test,spec}.{ts,tsx}',
  ],
  marketing: [
    'apps/marketing/app/**/*.{test,spec}.{ts,tsx}',
    'apps/marketing/components/**/*.{test,spec}.{ts,tsx}',
    'apps/marketing/lib/**/*.{test,spec}.{ts,tsx}',
  ],
  admin: ['apps/admin/app/**/*.{test,spec}.{ts,tsx}', 'apps/admin/lib/**/*.{test,spec}.{ts,tsx}'],
  console: [
    'apps/console/app/**/*.{test,spec}.{ts,tsx}',
    'apps/console/lib/**/*.{test,spec}.{ts,tsx}',
  ],
  status: [
    'apps/status/app/**/*.{test,spec}.{ts,tsx}',
    'apps/status/lib/**/*.{test,spec}.{ts,tsx}',
  ],
  all: [
    'apps/desktop/ui/**/*.{test,spec}.{ts,tsx}',
    'apps/web/app/**/*.{test,spec}.{ts,tsx}',
    'apps/web/lib/**/*.{test,spec}.{ts,tsx}',
    'apps/marketing/app/**/*.{test,spec}.{ts,tsx}',
    'apps/marketing/components/**/*.{test,spec}.{ts,tsx}',
    'apps/marketing/lib/**/*.{test,spec}.{ts,tsx}',
    'apps/admin/app/**/*.{test,spec}.{ts,tsx}',
    'apps/admin/lib/**/*.{test,spec}.{ts,tsx}',
    'apps/console/app/**/*.{test,spec}.{ts,tsx}',
    'apps/console/lib/**/*.{test,spec}.{ts,tsx}',
    'apps/status/app/**/*.{test,spec}.{ts,tsx}',
    'apps/status/lib/**/*.{test,spec}.{ts,tsx}',
  ],
};

const SCOPE_COVERAGE_INCLUDE: Record<TestScope, string[]> = {
  app: [
    'apps/desktop/ui/**/*.{ts,tsx}',
    'apps/web/app/(product)/**/*.{ts,tsx}',
    'apps/web/app/(admin)/**/*.{ts,tsx}',
    'apps/web/app/(auth)/**/*.{ts,tsx}',
    'apps/web/app/app-shell/**/*.{ts,tsx}',
    'apps/web/app/components/chat/**/*.{ts,tsx}',
    'apps/web/app/components/modals/**/*.{ts,tsx}',
    'apps/web/app/components/shell/**/*.{ts,tsx}',
    'apps/web/app/components/tool-usage/**/*.{ts,tsx}',
    'apps/web/app/components/markdown/**/*.{ts,tsx}',
    'apps/web/app/components/ui/**/*.{ts,tsx}',
    'apps/web/app/components/admin/**/*.{ts,tsx}',
    'apps/web/app/lib/**/*.{ts,tsx}',
    'apps/web/app/routes/**/*.{ts,tsx}',
    'apps/web/lib/**/*.{ts,tsx}',
  ],
  marketing: [
    'apps/marketing/app/**/*.{ts,tsx}',
    'apps/marketing/components/**/*.{ts,tsx}',
    'apps/marketing/lib/**/*.{ts,tsx}',
  ],
  admin: ['apps/admin/app/**/*.{ts,tsx}', 'apps/admin/lib/**/*.{ts,tsx}'],
  console: ['apps/console/app/**/*.{ts,tsx}', 'apps/console/lib/**/*.{ts,tsx}'],
  status: ['apps/status/app/**/*.{ts,tsx}', 'apps/status/lib/**/*.{ts,tsx}'],
  all: [
    'apps/desktop/ui/**/*.{ts,tsx}',
    'apps/web/app/**/*.{ts,tsx}',
    'apps/web/lib/**/*.{ts,tsx}',
    'apps/marketing/app/**/*.{ts,tsx}',
    'apps/marketing/components/**/*.{ts,tsx}',
    'apps/marketing/lib/**/*.{ts,tsx}',
    'apps/admin/app/**/*.{ts,tsx}',
    'apps/admin/lib/**/*.{ts,tsx}',
    'apps/console/app/**/*.{ts,tsx}',
    'apps/console/lib/**/*.{ts,tsx}',
    'apps/status/app/**/*.{ts,tsx}',
    'apps/status/lib/**/*.{ts,tsx}',
  ],
};

const FRONTEND_EXCLUDE_PATTERNS = [
  'tests/integration/**/*.{test,spec}.{ts,tsx}',
  'tests/database/**/*.{test,spec}.{ts,tsx}',
  'tests/contracts/**/*.{test,spec}.{ts,tsx}',
  'apps/web/tests/integration/**/*.{test,spec}.{ts,tsx}',
  'tests/e2e/**/*.{test,spec}.{ts,tsx}',
  'tests/real-*/**/*.{test,spec}.{ts,tsx}',
  ...(process.env['FRONTEND_TEST_EXCLUDE'] ?? '')
    .split(',')
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern.length > 0),
];

const FRONTEND_COVERAGE_IGNORE = [
  '**/*.test.{ts,tsx}',
  '**/*.spec.{ts,tsx}',
  '**/*.test-harness.{ts,tsx}',
  '**/*.test-utils.{ts,tsx}',
  '**/__mocks__/**',
  'node_modules/**',
  '**/dist/**',
  '**/.next/**',
  'generated/**',
  'qa/**',
  '**/mocks.ts',
  '**/*-styles.ts',
  '**/*-data.ts',
  '**/desktop-sync-adapter.ts',
  '**/ssr-guards.ts',
  // Web app strict-line exemptions: browser/native/media/serverless boundaries and
  // large presentational state surfaces are covered by focused unit tests, app smokes,
  // or runtime integration checks rather than the Bun line-denominator gate.
  'apps/web/app/(auth)/components/Login.tsx',
  'apps/web/app/(auth)/login/device/page.tsx',
  'apps/web/app/app-shell/AppShell.tsx',
  'apps/web/app/app-shell/shell/AppShellOverlays.tsx',
  'apps/web/app/app-shell/chat/ChatView.tsx',
  'apps/web/app/app-shell/navigation/CollapsedSidebar.tsx',
  'apps/desktop/ui/app-shell/DesktopAgentManagerPanel.tsx',
  'apps/desktop/ui/app-shell/DesktopBrowserPanel.tsx',
  'apps/desktop/ui/app-shell/WorkspaceFileTreePanel.tsx',
  'apps/web/app/app-shell/navigation/useAppShellNavigationActions.ts',
  'apps/web/app/app-shell/shell/useAppShellOverlayState.ts',
  'apps/desktop/ui/app-shell/useDesktopShellActions.ts',
  'apps/web/app/app-shell/chat/usePromptFormBridge.ts',
  'apps/web/app/app-shell/shell/useQuickSearchSelection.ts',
  'apps/web/app/components/chat/AgentExecutionPanel.tsx',
  'apps/web/app/components/chat/AgentExpandedDetail.tsx',
  'apps/web/app/components/chat/AgentExpandedPanels.tsx',
  'apps/web/app/components/chat/ComputerTheater.tsx',
  'apps/web/app/components/chat/ConversationItem.tsx',
  'apps/web/app/components/chat/ConversationList.tsx',
  'apps/web/app/components/chat/ExecutionReplay.tsx',
  'apps/web/app/components/chat/generatedMediaResult.ts',
  'apps/web/app/components/chat/MessageBubble.tsx',
  'apps/web/app/components/chat/PendingPrompts.tsx',
  'apps/web/app/components/chat/PromptForm.tsx',
  'apps/web/app/components/chat/prompt-form/composer/PromptActions.tsx',
  'apps/web/app/components/chat/prompt-form/composer/PromptAttachments.tsx',
  'apps/web/app/components/chat/prompt-form/composer/PromptComposerForm.tsx',
  'apps/web/app/components/chat/prompt-form/composer/PromptTemplateMenu.tsx',
  'apps/web/app/components/chat/prompt-form/controller/usePromptFormController.ts',
  'apps/web/app/components/chat/prompt-form/controller/usePromptTextareaAutofocus.ts',
  'apps/web/app/components/chat/prompt-form/orchestration/usePromptFormPreferences.ts',
  'apps/web/app/components/chat/prompt-form/presentation/PromptFormFooter.tsx',
  'apps/web/app/components/chat/prompt-form/realtime/realtimeBrowserAudio.ts',
  'apps/web/app/components/chat/prompt-form/realtime/RealtimeVoiceSessionPanel.tsx',
  'apps/desktop/ui/voice/useDesktopRealtimeVoiceSession.ts',
  'apps/web/app/components/chat/prompt-form/realtime/useRealtimeVoiceSession.ts',
  'apps/web/app/components/chat/prompt-form/submission/useWebPromptSubmission.ts',
  'apps/web/app/components/chat/ShareModal.tsx',
  'apps/web/app/components/chat/ToolUsageList.tsx',
  'apps/web/app/components/chat/useConversationDeleteHandler.ts',
  'apps/web/app/components/modals/ReportIssueModal.tsx',
  'apps/web/app/components/shell/Sidebar.tsx',
  'apps/web/app/components/shell/ThemeToggle.tsx',
  'apps/web/app/components/tool-usage/CodePanel.tsx',
  'apps/web/app/components/tool-usage/SearchChips.tsx',
  'apps/web/app/lib/api/agents.ts',
  'apps/web/app/lib/api/artifacts.ts',
  'apps/web/app/lib/api/models.ts',
  'apps/web/app/lib/bootstrap/app-shell-bootstrap-origin.ts',
  'apps/web/app/lib/bootstrap/app-shell-bootstrap-snapshots.ts',
  'apps/web/app/lib/dexie-db.ts',
  'apps/web/app/lib/hooks/useMobileViewport.ts',
  'apps/web/app/lib/hooks/usePendingPrompts.ts',
  'apps/web/app/lib/hooks/useSyncManager.ts',
  'apps/web/app/lib/mcp/useMcpToolCatalog.ts',
  'apps/desktop/ui/platform/bridge.ts',
  'apps/desktop/ui/platform/http-app-server.ts',
  'apps/desktop/ui/platform/streaming-runtime.ts',
  'apps/desktop/ui/platform/voice-gateway.ts',
  'apps/web/app/lib/platform/PlatformProvider.tsx',
  'apps/web/app/lib/platform/streaming-core.ts',
  'apps/web/app/lib/profile/billing/ProfileBillingSections.tsx',
  'apps/desktop/ui/profile/ProfileDesktopAppshotSection.tsx',
  'apps/desktop/ui/profile/ProfileDesktopLocalSection.helpers.ts',
  'apps/desktop/ui/profile/ProfileDesktopLocalSection.tsx',
  'apps/desktop/ui/profile/ProfileDesktopPairingSection.tsx',
  'apps/desktop/ui/profile/ProfileDesktopScreenMemorySection.tsx',
  'apps/desktop/ui/profile/ProfileDesktopWorkspaceSection.tsx',
  'apps/web/app/lib/profile/billing/ProfileFinanceSection.tsx',
  'apps/web/app/lib/profile/modal/ProfileModalSections.tsx',
  'apps/desktop/ui/profile/useDesktopBrowserPreviewSection.ts',
  'apps/web/app/lib/prompt/hydration-draft-capture.ts',
  'apps/web/app/lib/prompt/ModelSelectorControl.tsx',
  'apps/web/app/lib/prompt/slash-commands.ts',
  'apps/web/app/lib/providers/AuthProvider.tsx',
  'apps/web/app/lib/storage/dexie-metadata.ts',
  'apps/web/app/lib/storage/dexie-pending-changes.ts',
  'apps/desktop/ui/storage/tauri-adapter.ts',
  'apps/web/app/routes/__root.tsx',
  'apps/web/app/routes/api/-voice-gateway.ts',
  'apps/web/app/routes/api/dictation/transcribe.ts',
  'apps/web/app/routes/api/realtime/setup.ts',
  'apps/web/app/routes/api/speech/generate.ts',
  'apps/web/app/routes/artifacts.$artifactId.tsx',
  'apps/web/app/routes/artifacts.tsx',
];

const parseScope = (args: string[]): TestScope => {
  const scope = args
    .find((arg) => arg.startsWith('--scope='))
    ?.split('=')[1]
    ?.toLowerCase();
  const validScopes: TestScope[] = ['app', 'marketing', 'admin', 'console', 'status'];
  return validScopes.includes(scope as TestScope) ? (scope as TestScope) : 'all';
};

const getScopedPaths = (scope: TestScope) => {
  const scopeSuffix = scope === 'all' ? '' : `-${scope}`;
  const coverageRoot = path.resolve(process.cwd(), `coverage/frontend${scopeSuffix}`);
  return {
    coverageRoot,
    lcovPath: path.join(coverageRoot, 'lcov.info'),
    summaryPath: path.join(coverageRoot, 'coverage-summary.json'),
  };
};

const passthroughArgs = argsAfterScript('run-frontend-bun');
const scope = parseScope(passthroughArgs);
const repoRoot = process.cwd();
const testFiles = collectTestFiles({
  include: SCOPE_TEST_PATTERNS[scope],
  exclude: FRONTEND_EXCLUDE_PATTERNS,
});

process.stdout.write(`[test] Scope: ${scope.toUpperCase()} (${testFiles.length} test files)\n`);

if (testFiles.length === 0) {
  process.stdout.write('No frontend tests matched the include patterns.\n');
  process.exit(0);
}

const preloadArgs = ['--preload', './tests/bun-setup.ts', '--preload', './tests/setup/dom.ts'];
const absolutePreloads = preloadArgs.map((arg) =>
  arg.startsWith('./') ? path.resolve(repoRoot, arg) : arg
);
const marketingAppDir = path.join(repoRoot, 'apps/marketing');
const marketingSetupPreloadArgs = [
  '--preload',
  path.resolve(repoRoot, 'apps/marketing/bun-setup.ts'),
];
const coverageRequested = passthroughArgs.includes('--coverage');
const cleanedArgs = cleanCoverageArgs(passthroughArgs, ['--scope=']);

if (coverageRequested) {
  const paths = getScopedPaths(scope);
  const coveragePreloadArgs =
    scope === 'marketing' ? [...absolutePreloads, ...marketingSetupPreloadArgs] : preloadArgs;
  process.exit(
    await runLcovCoverage({
      files: testFiles,
      ...paths,
      cleanedArgs,
      includePatterns: SCOPE_COVERAGE_INCLUDE[scope],
      ignorePatterns: FRONTEND_COVERAGE_IGNORE,
      thresholdLabel: scope,
      summaryLabel: scope.toUpperCase(),
      preloadArgs: coveragePreloadArgs,
      ...(scope === 'marketing'
        ? {
            testCwd: marketingAppDir,
            testFileForCoverage: (file: string) =>
              path.relative(marketingAppDir, path.resolve(repoRoot, file)),
          }
        : {}),
    })
  );
}

const mode = (process.env['FRONTEND_TEST_MODE'] ?? '').toLowerCase();
const isAggressive = mode === 'aggressive';
const resolvedConcurrency = Math.min(
  normalizePositiveInt(process.env['FRONTEND_TEST_CONCURRENCY'], isAggressive ? 1 : 2),
  4
);
const shardCount = normalizePositiveInt(
  process.env['FRONTEND_TEST_SHARD_COUNT'],
  isAggressive ? 4 : 1
);
const shardIndexRaw = process.env['FRONTEND_TEST_SHARD_INDEX'];
const shardIndex = shardIndexRaw ? normalizePositiveInt(shardIndexRaw, 0) : null;

if (shardIndex !== null && (shardIndex < 1 || shardIndex > shardCount)) {
  process.stderr.write(
    `Invalid FRONTEND_TEST_SHARD_INDEX ${shardIndex} for shard count ${shardCount}\n`
  );
  process.exit(1);
}

const filesToRun =
  shardIndex !== null ? selectShard(testFiles, shardIndex - 1, shardCount) : testFiles;

process.exit(
  await runFilesWithDots({
    files: filesToRun,
    concurrency: resolvedConcurrency,
    commandForFile: (file) => {
      const isMarketing = file.includes('apps/marketing');
      const cwd = isMarketing ? marketingAppDir : repoRoot;
      const testFile = isMarketing ? path.relative(cwd, path.resolve(repoRoot, file)) : file;
      const filePreloads = isMarketing
        ? [...absolutePreloads, ...marketingSetupPreloadArgs]
        : absolutePreloads;
      return { cmd: ['bun', 'test', ...filePreloads, ...cleanedArgs, testFile], cwd };
    },
  })
);
