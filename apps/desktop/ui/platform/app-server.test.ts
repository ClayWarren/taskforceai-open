import { beforeEach, describe, expect, it, mock } from 'bun:test';

const mockInvokeTauri = mock(() => Promise.resolve(undefined));
const mockOpenDialog = mock(() => Promise.resolve<string | string[] | null>(null));

mock.module('./bridge', () => ({
  invokeTauri: mockInvokeTauri,
}));

mock.module('@tauri-apps/plugin-dialog', () => ({
  open: mockOpenDialog,
}));

const bridgeTestSuffix = '?bridge-test';
const loadModule = async () => import(`./app-server.ts${bridgeTestSuffix}`);
const expectTauriCalls = (...calls: Array<[string, unknown?]>) => {
  calls.forEach(([command, args], index) => {
    if (args === undefined) {
      expect(mockInvokeTauri).toHaveBeenNthCalledWith(index + 1, command);
      return;
    }
    expect(mockInvokeTauri).toHaveBeenNthCalledWith(index + 1, command, args);
  });
};

describe('desktop app-server bridge', () => {
  beforeEach(() => {
    mockInvokeTauri.mockClear();
    mockOpenDialog.mockClear();
    mockOpenDialog.mockResolvedValue(null);
  });

  it('invokes status through the shared app-server command', async () => {
    const {
      executeDesktopAppServerCommand,
      createDesktopAppServerProject,
      createDesktopWorktree,
      getDesktopAppServerHttpPairingInfo,
      getDesktopLocalEnvironmentStatus,
      getDesktopAppServerPet,
      getDesktopAppServerStatus,
      listDesktopWorktrees,
      runDesktopLocalEnvironmentAction,
      runDesktopLocalEnvironmentSetup,
      saveDesktopLocalEnvironment,
      setDesktopAppServerPet,
      setDesktopAppServerProjectWorkspace,
    } = await loadModule();

    await getDesktopAppServerHttpPairingInfo();
    await getDesktopAppServerStatus();
    await createDesktopAppServerProject({
      name: 'existing-project',
      workspaceRoots: ['/repo/existing-project'],
    });
    await setDesktopAppServerProjectWorkspace({
      projectId: 12,
      workspaceRoots: ['/repo/existing-project'],
    });
    await getDesktopLocalEnvironmentStatus();
    await saveDesktopLocalEnvironment({
      config: {
        setup: { default: 'bun install' },
        actions: [{ id: 'test', name: 'Test', scripts: { default: 'bun test' } }],
      },
    });
    await runDesktopLocalEnvironmentSetup();
    await runDesktopLocalEnvironmentAction({ actionId: 'test' });
    await listDesktopWorktrees({ repository: '/repo' });
    await createDesktopWorktree({
      repository: '/repo',
      branch: 'codex/test',
      baseRef: 'main',
    });
    await executeDesktopAppServerCommand({ input: '/status' });
    await getDesktopAppServerPet();
    await setDesktopAppServerPet({ mood: 'celebrate', visible: true });

    expectTauriCalls(
      ['app_server_http_pairing_info'],
      ['app_server_status_summary'],
      [
        'app_server_project_create',
        {
          params: {
            name: 'existing-project',
            workspaceRoots: ['/repo/existing-project'],
          },
        },
      ],
      [
        'app_server_project_workspace_set',
        {
          params: {
            projectId: 12,
            workspaceRoots: ['/repo/existing-project'],
          },
        },
      ],
      ['local_environment_status'],
      [
        'local_environment_save',
        {
          params: {
            config: {
              setup: { default: 'bun install' },
              actions: [{ id: 'test', name: 'Test', scripts: { default: 'bun test' } }],
            },
          },
        },
      ],
      ['local_environment_run_setup'],
      ['local_environment_run_action', { params: { actionId: 'test' } }],
      ['desktop_worktree_list', { params: { repository: '/repo' } }],
      [
        'desktop_worktree_create',
        {
          params: {
            repository: '/repo',
            branch: 'codex/test',
            baseRef: 'main',
          },
        },
      ],
      ['app_server_command_execute', { params: { input: '/status' } }],
      ['app_server_pet_get'],
      ['app_server_pet_set', { params: { mood: 'celebrate', visible: true } }]
    );
  });

  it('manages local agent sessions and automation through the shared app-server command', async () => {
    const {
      cancelDesktopAppServerAgentSession,
      createDesktopAppServerAgentSession,
      forkDesktopAppServerAgentSession,
      inspectDesktopAppServerDiagnostics,
      listDesktopAppServerAgentSessions,
      listDesktopAppServerChannels,
      listDesktopAppServerSchedules,
      pauseDesktopAppServerAgentSession,
      resumeDesktopAppServerAgentSession,
      runDesktopAppServerAgentSession,
      tickDesktopAppServerSchedules,
    } = await loadModule();

    await listDesktopAppServerAgentSessions();
    await createDesktopAppServerAgentSession({
      objective: 'Keep parity moving',
      title: 'Parity',
      source: 'desktop',
    });
    await pauseDesktopAppServerAgentSession('agent-1');
    await resumeDesktopAppServerAgentSession('agent-1');
    await cancelDesktopAppServerAgentSession('agent-1');
    await forkDesktopAppServerAgentSession('agent-1');
    await runDesktopAppServerAgentSession({
      sessionId: 'agent-1',
      prompt: 'Start the next checkpoint',
    });
    await inspectDesktopAppServerDiagnostics();
    await listDesktopAppServerChannels();
    await listDesktopAppServerSchedules();
    await tickDesktopAppServerSchedules({ now: 123 });

    expectTauriCalls(
      ['app_server_agent_session_list'],
      [
        'app_server_agent_session_create',
        {
          params: {
            objective: 'Keep parity moving',
            title: 'Parity',
            source: 'desktop',
          },
        },
      ],
      ['app_server_agent_session_pause', { sessionId: 'agent-1' }],
      ['app_server_agent_session_resume', { sessionId: 'agent-1' }],
      ['app_server_agent_session_cancel', { sessionId: 'agent-1' }],
      ['app_server_agent_session_fork', { sessionId: 'agent-1' }],
      [
        'app_server_agent_session_run',
        {
          params: { sessionId: 'agent-1', prompt: 'Start the next checkpoint' },
        },
      ],
      ['app_server_diagnostics_inspect'],
      ['app_server_channel_list'],
      ['app_server_schedule_list'],
      ['app_server_schedule_tick', { params: { now: 123 } }]
    );
  });

  it('manages auth through the shared app-server command', async () => {
    const {
      getDesktopAppServerAuthStatus,
      logoutDesktopAppServerAuth,
      pollDesktopAppServerDeviceLogin,
      startDesktopAppServerDeviceLogin,
    } = await loadModule();

    await getDesktopAppServerAuthStatus();
    await startDesktopAppServerDeviceLogin();
    await pollDesktopAppServerDeviceLogin('device-code-1');
    await logoutDesktopAppServerAuth();

    expectTauriCalls(
      ['app_server_auth_status'],
      ['app_server_auth_device_start'],
      ['app_server_auth_device_poll', { deviceCode: 'device-code-1' }],
      ['app_server_auth_logout']
    );
  });

  it('bridges thread handoff, replay, and run status commands', async () => {
    const bridge = await loadModule();

    await bridge.handoffDesktopAppServerThread({ threadId: 'thread-1' } as never);
    await bridge.createDesktopRecordReplaySkill({ name: 'Replay' } as never);
    await bridge.getDesktopAppServerRunStatus('run-1');

    expect(mockInvokeTauri).toHaveBeenCalledTimes(3);
  });

  it('opens the active workspace in a desktop application', async () => {
    const { openDesktopWorkspaceIn } = await loadModule();

    await openDesktopWorkspaceIn({ root: '/tmp/project', target: 'cursor' });

    expectTauriCalls([
      'desktop_workspace_open_in',
      { params: { root: '/tmp/project', target: 'cursor' } },
    ]);
  });

  it('picks a single desktop workspace folder', async () => {
    const { pickDesktopWorkspaceFolder } = await loadModule();
    mockOpenDialog.mockResolvedValueOnce('/tmp/project').mockResolvedValueOnce(['ignored']);

    await expect(pickDesktopWorkspaceFolder()).resolves.toBe('/tmp/project');
    await expect(pickDesktopWorkspaceFolder()).resolves.toBeNull();
    expect(mockOpenDialog).toHaveBeenCalledWith({
      directory: true,
      multiple: false,
      title: 'Use an existing folder',
    });
  });

  it('submits runs through the shared app-server command', async () => {
    const {
      enableDesktopLocalCoding,
      disableDesktopLocalCoding,
      getDesktopGitReviewDiff,
      getDesktopGitReviewStatus,
      addDesktopGitReviewComment,
      listDesktopGitReviewComments,
      resolveDesktopGitReviewComment,
      runDesktopGitReviewPullRequestAction,
      updateDesktopGitReviewStage,
      submitDesktopAppServerRun,
    } = await loadModule();
    const params = {
      prompt: 'Research the bug',
      modelId: 'gpt-5',
      quickMode: true,
      autonomous: true,
      computerUse: false,
      projectId: 7,
      attachmentIds: ['att-1'],
    };

    await submitDesktopAppServerRun(params);
    await enableDesktopLocalCoding({ workspace: '/tmp/project' });
    await disableDesktopLocalCoding();
    await getDesktopGitReviewStatus({ workspace: '/tmp/project' });
    await getDesktopGitReviewDiff({
      workspace: '/tmp/project',
      scope: 'unstaged',
      maxBytes: 4096,
    });
    await updateDesktopGitReviewStage({
      workspace: '/tmp/project',
      paths: ['src/app.ts'],
      staged: true,
    });
    await listDesktopGitReviewComments({ workspace: '/tmp/project' });
    await addDesktopGitReviewComment({
      workspace: '/tmp/project',
      path: 'src/app.ts',
      line: 4,
      body: 'Tighten this branch',
    });
    await resolveDesktopGitReviewComment({
      commentId: 'comment-1',
      resolved: true,
    });
    await runDesktopGitReviewPullRequestAction({
      workspace: '/tmp/project',
      action: 'approve',
      body: 'Looks good.',
    });

    expectTauriCalls(
      ['app_server_submit_run', { params }],
      ['app_server_enable_local_coding', { params: { workspace: '/tmp/project' } }],
      ['app_server_disable_local_coding', undefined],
      ['app_server_git_review_status', { params: { workspace: '/tmp/project' } }],
      [
        'app_server_git_review_diff',
        {
          params: {
            workspace: '/tmp/project',
            scope: 'unstaged',
            maxBytes: 4096,
          },
        },
      ],
      [
        'app_server_git_review_stage',
        {
          params: {
            workspace: '/tmp/project',
            paths: ['src/app.ts'],
            staged: true,
          },
        },
      ],
      ['app_server_git_review_comment_list', { params: { workspace: '/tmp/project' } }],
      [
        'app_server_git_review_comment_add',
        {
          params: {
            workspace: '/tmp/project',
            path: 'src/app.ts',
            line: 4,
            body: 'Tighten this branch',
          },
        },
      ],
      [
        'app_server_git_review_comment_resolve',
        { params: { commentId: 'comment-1', resolved: true } },
      ],
      [
        'app_server_git_review_pull_request_action',
        {
          params: {
            workspace: '/tmp/project',
            action: 'approve',
            body: 'Looks good.',
          },
        },
      ]
    );
  });

  it('routes voice requests through the shared app-server command', async () => {
    const {
      generateDesktopAppServerVoiceSpeech,
      setupDesktopAppServerRealtimeVoice,
      transcribeDesktopAppServerVoice,
    } = await loadModule();

    await transcribeDesktopAppServerVoice({
      audioBase64: 'YXVkaW8=',
      mediaType: 'audio/webm',
      fileName: 'dictation.webm',
    });
    await generateDesktopAppServerVoiceSpeech({ text: 'read this' });
    await setupDesktopAppServerRealtimeVoice({
      sessionConfig: { outputModalities: ['audio'] },
    });

    expectTauriCalls(
      [
        'app_server_voice_transcribe',
        {
          params: {
            audioBase64: 'YXVkaW8=',
            mediaType: 'audio/webm',
            fileName: 'dictation.webm',
          },
        },
      ],
      ['app_server_voice_speech_generate', { params: { text: 'read this' } }],
      [
        'app_server_voice_realtime_setup',
        { params: { sessionConfig: { outputModalities: ['audio'] } } },
      ]
    );
  });

  it('cancels runs through the shared app-server command', async () => {
    const { cancelDesktopAppServerRun } = await loadModule();

    await cancelDesktopAppServerRun('run-1');

    expect(mockInvokeTauri).toHaveBeenCalledWith('app_server_cancel_run', {
      runId: 'run-1',
    });
  });

  it('manages Remote settings and controllers through the shared app-server command', async () => {
    const {
      createDesktopRemotePairingCode,
      getDesktopRemoteSettings,
      listDesktopRemoteControllers,
      revokeDesktopRemoteController,
      updateDesktopRemoteSettings,
    } = await loadModule();

    await getDesktopRemoteSettings();
    await updateDesktopRemoteSettings({ allowConnections: true });
    await createDesktopRemotePairingCode();
    await listDesktopRemoteControllers();
    await revokeDesktopRemoteController('device-1');

    expectTauriCalls(
      ['app_server_remote_settings_get'],
      ['app_server_remote_settings_update', { params: { allowConnections: true } }],
      ['app_server_remote_pairing_code_create'],
      ['app_server_remote_controller_list'],
      ['app_server_remote_controller_revoke', { params: { deviceId: 'device-1' } }]
    );
  });

  it('manages modes through the shared app-server command', async () => {
    const {
      getDesktopAppServerComputerUseMode,
      getDesktopAppServerHybridMode,
      setDesktopAppServerComputerUseMode,
      setDesktopAppServerHybridMode,
    } = await loadModule();

    await getDesktopAppServerComputerUseMode();
    await setDesktopAppServerComputerUseMode(false);
    await getDesktopAppServerHybridMode();
    await setDesktopAppServerHybridMode({
      enabled: true,
      modelId: 'ollama/gemma4:e4b',
      role: 'Skeptic',
    });

    expectTauriCalls(
      ['app_server_computer_use_mode_get'],
      ['app_server_computer_use_mode_set', { enabled: false }],
      ['app_server_hybrid_mode_get'],
      [
        'app_server_hybrid_mode_set',
        { enabled: true, modelId: 'ollama/gemma4:e4b', role: 'Skeptic' },
      ]
    );
  });

  it('manages model and local settings through the shared app-server command', async () => {
    const {
      getDesktopAppServerLocalSettings,
      listDesktopAppServerModels,
      updateDesktopAppServerLocalSettings,
    } = await loadModule();

    await getDesktopAppServerLocalSettings();
    await updateDesktopAppServerLocalSettings({
      theme: 'dark',
      loggingLevel: 'debug',
    });
    await listDesktopAppServerModels();

    expectTauriCalls(
      ['app_server_local_settings_get'],
      ['app_server_local_settings_update', { params: { theme: 'dark', loggingLevel: 'debug' } }],
      ['app_server_model_list']
    );
  });

  it('loads app-server capability and context inventories', async () => {
    const {
      addDesktopAppServerAttachment,
      getDesktopAppServerBrowserStatus,
      getDesktopAppServerComputerUseStatus,
      getDesktopAppServerContextSummary,
      getDesktopWorkspaceFileTree,
      listDesktopAppServerPlugins,
      readDesktopWorkspaceFile,
      writeDesktopWorkspaceFile,
      setDesktopAppServerPluginEnabled,
    } = await loadModule();

    await listDesktopAppServerPlugins();
    await setDesktopAppServerPluginEnabled('browser@openai-bundled', true);
    await addDesktopAppServerAttachment({ path: '/tmp/appshot.png' });
    await getDesktopAppServerComputerUseStatus();
    await getDesktopAppServerBrowserStatus();
    await getDesktopAppServerContextSummary();
    await getDesktopWorkspaceFileTree({ maxDepth: 3 });
    await readDesktopWorkspaceFile({ path: 'README.md' });
    await writeDesktopWorkspaceFile({
      path: 'README.md',
      content: '# Updated',
      expectedContent: '# Original',
    });

    expectTauriCalls(
      ['app_server_plugin_list'],
      ['app_server_plugin_set_enabled', { pluginId: 'browser@openai-bundled', enabled: true }],
      ['app_server_attachment_add', { params: { path: '/tmp/appshot.png' } }],
      ['app_server_computer_use_status'],
      ['app_server_browser_status'],
      ['app_server_context_summary'],
      ['workspace_file_tree', { params: { maxDepth: 3 } }],
      ['workspace_file_read', { params: { path: 'README.md' } }],
      [
        'workspace_file_write',
        {
          params: {
            path: 'README.md',
            content: '# Updated',
            expectedContent: '# Original',
          },
        },
      ]
    );
  });

  it('controls the desktop browser preview pane', async () => {
    const {
      captureDesktopBrowserPreviewScreenshot,
      captureDesktopAppshotFrontmost,
      clearDesktopBrowserPreviewDiagnostics,
      closeDesktopBrowserPreview,
      closeDesktopBrowserPreviewDevtools,
      getDesktopBrowserPreviewDiagnostics,
      getDesktopBrowserPreviewStatus,
      getDesktopBrowserPreviewDevtoolsStatus,
      goBackDesktopBrowserPreview,
      goForwardDesktopBrowserPreview,
      inspectDesktopBrowserPreview,
      mountDesktopBrowserPreview,
      observeDesktopComputerUse,
      openDesktopBrowserPreview,
      openDesktopBrowserPreviewDevtools,
      reloadDesktopBrowserPreview,
      runDesktopBrowserPreviewAction,
      runDesktopBrowserDeveloperCommand,
      setDesktopBrowserPreviewAnnotations,
      showDesktopBrowserPreview,
    } = await loadModule();

    await openDesktopBrowserPreview({ url: 'http://localhost:3000' });
    await showDesktopBrowserPreview();
    await mountDesktopBrowserPreview({
      bounds: { x: 720, y: 0, width: 560, height: 720 },
    });
    await getDesktopBrowserPreviewStatus();
    await goBackDesktopBrowserPreview();
    await goForwardDesktopBrowserPreview();
    await reloadDesktopBrowserPreview();
    await closeDesktopBrowserPreview();
    await runDesktopBrowserPreviewAction({
      action: 'click',
      selector: '#save',
    });
    await inspectDesktopBrowserPreview({ selector: 'button', maxElements: 4 });
    await setDesktopBrowserPreviewAnnotations({
      annotations: [
        {
          id: 'note-1',
          text: 'Move this button.',
          target: '#save',
          x: 12,
          y: 18,
          width: 80,
          height: 32,
          kind: 'area',
        },
      ],
    });
    await captureDesktopBrowserPreviewScreenshot();
    await observeDesktopComputerUse();
    await captureDesktopAppshotFrontmost();
    await openDesktopBrowserPreviewDevtools();
    await closeDesktopBrowserPreviewDevtools();
    await getDesktopBrowserPreviewDevtoolsStatus();
    await getDesktopBrowserPreviewDiagnostics();
    await clearDesktopBrowserPreviewDiagnostics();
    await runDesktopBrowserDeveloperCommand({
      method: 'Browser.startSession',
      captureBodies: false,
    });

    expectTauriCalls(
      ['desktop_browser_open', { params: { url: 'http://localhost:3000' } }],
      ['desktop_browser_show'],
      ['desktop_browser_mount', { params: { bounds: { x: 720, y: 0, width: 560, height: 720 } } }],
      ['desktop_browser_status'],
      ['desktop_browser_back'],
      ['desktop_browser_forward'],
      ['desktop_browser_reload'],
      ['desktop_browser_close'],
      ['desktop_browser_action', { params: { action: 'click', selector: '#save' } }],
      ['desktop_browser_inspect', { params: { selector: 'button', maxElements: 4 } }],
      [
        'desktop_browser_annotations_set',
        {
          params: {
            annotations: [
              {
                id: 'note-1',
                text: 'Move this button.',
                target: '#save',
                x: 12,
                y: 18,
                width: 80,
                height: 32,
                kind: 'area',
              },
            ],
          },
        },
      ],
      ['desktop_browser_screenshot'],
      ['desktop_computer_use_observe'],
      ['appshot_capture_frontmost'],
      ['desktop_browser_devtools_open'],
      ['desktop_browser_devtools_close'],
      ['desktop_browser_devtools_status'],
      ['desktop_browser_diagnostics'],
      ['desktop_browser_diagnostics_clear'],
      [
        'desktop_browser_developer_command',
        { params: { method: 'Browser.startSession', captureBodies: false } },
      ]
    );
  });
});
