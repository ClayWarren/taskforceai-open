import { beforeEach, describe, expect, it, mock } from 'bun:test';

const mockInvokeTauri = mock(() => Promise.resolve(undefined));

mock.module('./bridge', () => ({
  invokeTauri: mockInvokeTauri,
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
  });

  it('invokes status through the shared app-server command', async () => {
    const {
      executeDesktopAppServerCommand,
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
    } = await loadModule();

    await getDesktopAppServerHttpPairingInfo();
    await getDesktopAppServerStatus();
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
        { params: { repository: '/repo', branch: 'codex/test', baseRef: 'main' } },
      ],
      ['app_server_command_execute', { params: { input: '/status' } }],
      ['app_server_pet_get'],
      ['app_server_pet_set', { params: { mood: 'celebrate', visible: true } }]
    );
  });

  it('manages local agent sessions and automation through the shared app-server command', async () => {
    const {
      addDesktopAppServerChannel,
      addDesktopAppServerSchedule,
      cancelDesktopAppServerAgentSession,
      createDesktopAppServerAgentSession,
      deleteDesktopAppServerChannel,
      deleteDesktopAppServerSchedule,
      disableDesktopAppServerSchedule,
      enableDesktopAppServerSchedule,
      forkDesktopAppServerAgentSession,
      inspectDesktopAppServerDiagnostics,
      listDesktopAppServerAgentSessions,
      listDesktopAppServerChannels,
      listDesktopAppServerSchedules,
      messageDesktopAppServerAgentSession,
      pauseDesktopAppServerAgentSession,
      pushDesktopAppServerChannel,
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
    await messageDesktopAppServerAgentSession({
      sessionId: 'agent-1',
      message: 'Ship the bridge first',
    });
    await forkDesktopAppServerAgentSession('agent-1');
    await runDesktopAppServerAgentSession({
      sessionId: 'agent-1',
      prompt: 'Start the next checkpoint',
    });
    await inspectDesktopAppServerDiagnostics();
    await listDesktopAppServerChannels();
    await addDesktopAppServerChannel({
      name: 'desktop',
      kind: 'local',
      targetSessionId: 'agent-1',
      enabled: true,
    });
    await pushDesktopAppServerChannel({
      channelId: 'channel-1',
      message: 'incoming note',
      dispatch: true,
    });
    await deleteDesktopAppServerChannel('channel-1');
    await listDesktopAppServerSchedules();
    await addDesktopAppServerSchedule({
      name: 'daily',
      prompt: 'summarize sessions',
      cadence: 'daily',
      targetSessionId: 'agent-1',
      enabled: true,
    });
    await disableDesktopAppServerSchedule('schedule-1');
    await enableDesktopAppServerSchedule('schedule-1');
    await tickDesktopAppServerSchedules({ now: 123 });
    await deleteDesktopAppServerSchedule('schedule-1');

    expectTauriCalls(
      ['app_server_agent_session_list'],
      [
        'app_server_agent_session_create',
        { params: { objective: 'Keep parity moving', title: 'Parity', source: 'desktop' } },
      ],
      ['app_server_agent_session_pause', { sessionId: 'agent-1' }],
      ['app_server_agent_session_resume', { sessionId: 'agent-1' }],
      ['app_server_agent_session_cancel', { sessionId: 'agent-1' }],
      [
        'app_server_agent_session_message',
        { params: { sessionId: 'agent-1', message: 'Ship the bridge first' } },
      ],
      ['app_server_agent_session_fork', { sessionId: 'agent-1' }],
      [
        'app_server_agent_session_run',
        { params: { sessionId: 'agent-1', prompt: 'Start the next checkpoint' } },
      ],
      ['app_server_diagnostics_inspect'],
      ['app_server_channel_list'],
      [
        'app_server_channel_add',
        {
          params: { name: 'desktop', kind: 'local', targetSessionId: 'agent-1', enabled: true },
        },
      ],
      [
        'app_server_channel_push',
        { params: { channelId: 'channel-1', message: 'incoming note', dispatch: true } },
      ],
      ['app_server_channel_delete', { channelId: 'channel-1' }],
      ['app_server_schedule_list'],
      [
        'app_server_schedule_add',
        {
          params: {
            name: 'daily',
            prompt: 'summarize sessions',
            cadence: 'daily',
            targetSessionId: 'agent-1',
            enabled: true,
          },
        },
      ],
      ['app_server_schedule_disable', { scheduleId: 'schedule-1' }],
      ['app_server_schedule_enable', { scheduleId: 'schedule-1' }],
      ['app_server_schedule_tick', { params: { now: 123 } }],
      ['app_server_schedule_delete', { scheduleId: 'schedule-1' }]
    );
  });

  it('passes history limit through the shared app-server command', async () => {
    const { listDesktopAppServerHistory } = await loadModule();

    await listDesktopAppServerHistory(25);

    expect(mockInvokeTauri).toHaveBeenCalledWith('app_server_history_list', { limit: 25 });
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

  it('submits runs through the shared app-server command', async () => {
    const {
      enableDesktopLocalCoding,
      getDesktopGitReviewDiff,
      getDesktopGitReviewStatus,
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
    await getDesktopGitReviewStatus({ workspace: '/tmp/project' });
    await getDesktopGitReviewDiff({
      workspace: '/tmp/project',
      scope: 'Unstaged',
      maxBytes: 4096,
    });

    expectTauriCalls(
      ['app_server_submit_run', { params }],
      ['app_server_enable_local_coding', { params: { workspace: '/tmp/project' } }],
      ['app_server_git_review_status', { params: { workspace: '/tmp/project' } }],
      [
        'app_server_git_review_diff',
        { params: { workspace: '/tmp/project', scope: 'Unstaged', maxBytes: 4096 } },
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
    await setupDesktopAppServerRealtimeVoice({ sessionConfig: { outputModalities: ['audio'] } });

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

    expect(mockInvokeTauri).toHaveBeenCalledWith('app_server_cancel_run', { runId: 'run-1' });
  });

  it('lists pending changes through the shared app-server command', async () => {
    const { listDesktopAppServerPendingChanges } = await loadModule();

    await listDesktopAppServerPendingChanges();

    expect(mockInvokeTauri).toHaveBeenCalledWith('app_server_pending_change_list');
  });

  it('adds pending changes through the shared app-server command', async () => {
    const { addDesktopAppServerPendingChange } = await loadModule();
    const change = {
      type: 'conversation',
      entityId: 'conv-1',
      operation: 'create',
      data: { title: 'Draft' },
      createdAt: 1,
    };

    await addDesktopAppServerPendingChange(change);

    expect(mockInvokeTauri).toHaveBeenCalledWith('app_server_pending_change_add', { change });
  });

  it('updates and removes pending changes through the shared app-server command', async () => {
    const {
      clearDesktopAppServerPendingChanges,
      deleteDesktopAppServerPendingChange,
      updateDesktopAppServerPendingChangeData,
    } = await loadModule();

    await updateDesktopAppServerPendingChangeData(3, { synced: true });
    await deleteDesktopAppServerPendingChange(3);
    await clearDesktopAppServerPendingChanges();

    expectTauriCalls(
      ['app_server_pending_change_update_data', { id: 3, data: { synced: true } }],
      ['app_server_pending_change_delete', { id: 3 }],
      ['app_server_pending_change_clear']
    );
  });

  it('manages sync metadata through the shared app-server command', async () => {
    const {
      clearDesktopAppServerMetadata,
      configureDesktopAppServerSync,
      ensureDesktopAppServerSyncDevice,
      getDesktopAppServerSyncStatus,
    } = await loadModule();

    await getDesktopAppServerSyncStatus();
    await configureDesktopAppServerSync({ deviceId: 'device-1', lastSyncVersion: 42 });
    await ensureDesktopAppServerSyncDevice();
    await clearDesktopAppServerMetadata();

    expectTauriCalls(
      ['app_server_sync_status'],
      ['app_server_sync_configure', { deviceId: 'device-1', lastSyncVersion: 42 }],
      ['app_server_sync_ensure_device'],
      ['app_server_metadata_clear_all']
    );
  });

  it('manages modes through the shared app-server command', async () => {
    const {
      getDesktopAppServerAutonomousMode,
      getDesktopAppServerComputerUseMode,
      getDesktopAppServerHybridMode,
      getDesktopAppServerQuickMode,
      setDesktopAppServerAutonomousMode,
      setDesktopAppServerComputerUseMode,
      setDesktopAppServerHybridMode,
      setDesktopAppServerQuickMode,
    } = await loadModule();

    await getDesktopAppServerQuickMode();
    await setDesktopAppServerQuickMode(true);
    await getDesktopAppServerAutonomousMode();
    await setDesktopAppServerAutonomousMode(true);
    await getDesktopAppServerComputerUseMode();
    await setDesktopAppServerComputerUseMode(false);
    await getDesktopAppServerHybridMode();
    await setDesktopAppServerHybridMode({
      enabled: true,
      modelId: 'ollama/gemma4:e4b',
      role: 'Skeptic',
    });

    expectTauriCalls(
      ['app_server_quick_mode_get'],
      ['app_server_quick_mode_set', { enabled: true }],
      ['app_server_autonomous_mode_get'],
      ['app_server_autonomous_mode_set', { enabled: true }],
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
      resetDesktopAppServerModel,
      selectDesktopAppServerModel,
      updateDesktopAppServerLocalSettings,
    } = await loadModule();

    await getDesktopAppServerLocalSettings();
    await updateDesktopAppServerLocalSettings({ theme: 'dark', loggingLevel: 'debug' });
    await listDesktopAppServerModels();
    await selectDesktopAppServerModel('ollama/gemma4:e2b');
    await resetDesktopAppServerModel();

    expectTauriCalls(
      ['app_server_local_settings_get'],
      ['app_server_local_settings_update', { params: { theme: 'dark', loggingLevel: 'debug' } }],
      ['app_server_model_list'],
      ['app_server_model_select', { modelId: 'ollama/gemma4:e2b' }],
      ['app_server_model_reset']
    );
  });

  it('loads app-server capability and context inventories', async () => {
    const {
      addDesktopAppServerAttachment,
      clearDesktopAppServerAttachments,
      getDesktopAppServerBrowserStatus,
      getDesktopAppServerComputerUseStatus,
      getDesktopAppServerContextSummary,
      getDesktopAppServerMemorySummary,
      listDesktopAppServerAttachments,
      listDesktopAppServerPlugins,
      listDesktopAppServerSkills,
      setDesktopAppServerPluginEnabled,
    } = await loadModule();

    await listDesktopAppServerSkills();
    await listDesktopAppServerPlugins();
    await setDesktopAppServerPluginEnabled('browser@openai-bundled', true);
    await listDesktopAppServerAttachments();
    await addDesktopAppServerAttachment({ path: '/tmp/appshot.png' });
    await clearDesktopAppServerAttachments();
    await getDesktopAppServerComputerUseStatus();
    await getDesktopAppServerBrowserStatus();
    await getDesktopAppServerContextSummary();
    await getDesktopAppServerMemorySummary();

    expectTauriCalls(
      ['app_server_skill_list'],
      ['app_server_plugin_list'],
      ['app_server_plugin_set_enabled', { pluginId: 'browser@openai-bundled', enabled: true }],
      ['app_server_attachment_list'],
      ['app_server_attachment_add', { params: { path: '/tmp/appshot.png' } }],
      ['app_server_attachment_clear'],
      ['app_server_computer_use_status'],
      ['app_server_browser_status'],
      ['app_server_context_summary'],
      ['app_server_memory_summary']
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
      setDesktopBrowserPreviewAnnotations,
      showDesktopBrowserPreview,
    } = await loadModule();

    await openDesktopBrowserPreview({ url: 'http://localhost:3000' });
    await showDesktopBrowserPreview();
    await mountDesktopBrowserPreview({ bounds: { x: 720, y: 0, width: 560, height: 720 } });
    await getDesktopBrowserPreviewStatus();
    await goBackDesktopBrowserPreview();
    await goForwardDesktopBrowserPreview();
    await reloadDesktopBrowserPreview();
    await closeDesktopBrowserPreview();
    await runDesktopBrowserPreviewAction({ action: 'click', selector: '#save' });
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
      ['desktop_browser_diagnostics_clear']
    );
  });

  it('manages Ollama through the shared app-server command', async () => {
    const { ensureDesktopAppServerOllama, getDesktopAppServerOllamaStatus } = await loadModule();

    await getDesktopAppServerOllamaStatus('http://localhost:11434/v1');
    await ensureDesktopAppServerOllama({
      baseUrl: 'http://localhost:11434/v1',
      modelId: 'ollama/gemma4:e2b',
    });

    expectTauriCalls(
      ['app_server_ollama_status', { baseUrl: 'http://localhost:11434/v1' }],
      [
        'app_server_ollama_ensure',
        { baseUrl: 'http://localhost:11434/v1', modelId: 'ollama/gemma4:e2b' },
      ]
    );
  });
});
