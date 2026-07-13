import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

import '../../../../../../tests/setup/dom';

const useFileAttachmentsMock = vi.fn();
const useVoiceControlMock = vi.fn();
const useTranslationMock = vi.fn();
const useAuthMock = vi.fn();
const useStreamingMock = vi.fn();
const useProjectsMock = vi.fn();
const useConversationStoreMock = vi.fn();
const usePlatformRuntimeMock = vi.fn();
const useStorageAdapterMock = vi.fn();
const useMobileViewportMock = vi.fn();
const useLockedComputerUseStatusMock = vi.fn();
const usePromptFormPreferencesMock = vi.fn();
const usePromptFormViewStateMock = vi.fn();
const usePromptModeBadgesMock = vi.fn();
const usePromptModelSelectorMock = vi.fn();
const usePromptTextareaAutofocusMock = vi.fn();
const useRealtimeVoiceSessionMock = vi.fn();
const useWebPromptSubmissionMock = vi.fn();
const tauriInvokeMock = vi.fn();
const loggerDebugMock = vi.fn();

vi.mock('@taskforceai/react-core', () => ({
  useFileAttachments: useFileAttachmentsMock,
  useVoiceControl: useVoiceControlMock,
}));

vi.mock('react-i18next', () => ({
  useTranslation: useTranslationMock,
}));

vi.mock('../../../lib/logger', () => ({
  logger: {
    debug: loggerDebugMock,
  },
}));

vi.mock('../../../lib/hooks/useMobileViewport', () => ({
  useMobileViewport: useMobileViewportMock,
}));

vi.mock('../../../lib/platform/PlatformProvider', () => ({
  useConversationStore: useConversationStoreMock,
  usePlatformRuntime: usePlatformRuntimeMock,
  useStorageAdapter: useStorageAdapterMock,
}));

vi.mock('../../../lib/providers/AuthProvider', () => ({
  useAuth: useAuthMock,
}));

vi.mock('../../../lib/providers/StreamingProvider', () => ({
  useStreaming: useStreamingMock,
}));

vi.mock('../../../lib/projects/ProjectsContext', () => ({
  useProjects: useProjectsMock,
}));

vi.mock('./useLockedComputerUseStatus', () => ({
  useLockedComputerUseStatus: useLockedComputerUseStatusMock,
}));

vi.mock('./usePromptFormPreferences', () => ({
  usePromptFormPreferences: usePromptFormPreferencesMock,
}));

vi.mock('./usePromptFormViewState', () => ({
  usePromptFormViewState: usePromptFormViewStateMock,
}));

vi.mock('./usePromptModeBadges', () => ({
  usePromptModeBadges: usePromptModeBadgesMock,
}));

vi.mock('./usePromptModelSelector', () => ({
  usePromptModelSelector: usePromptModelSelectorMock,
}));

vi.mock('./usePromptTextareaAutofocus', () => ({
  usePromptTextareaAutofocus: usePromptTextareaAutofocusMock,
}));

vi.mock('./useRealtimeVoiceSession', () => ({
  useRealtimeVoiceSession: useRealtimeVoiceSessionMock,
}));

vi.mock('./useWebPromptSubmission', () => ({
  useWebPromptSubmission: useWebPromptSubmissionMock,
}));

import { usePromptFormController } from './usePromptFormController';
import { createLargePasteAttachment } from './largePasteAttachment';

const originalFetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
const originalTauriDescriptor = Object.getOwnPropertyDescriptor(window, '__TAURI__');

const restoreFetch = () => {
  if (originalFetchDescriptor) {
    Object.defineProperty(globalThis, 'fetch', originalFetchDescriptor);
    return;
  }
  Reflect.deleteProperty(globalThis, 'fetch');
};

const restoreTauri = () => {
  if (originalTauriDescriptor) {
    Object.defineProperty(window, '__TAURI__', originalTauriDescriptor);
    return;
  }
  Reflect.deleteProperty(window, '__TAURI__');
};

const makePreferences = () => ({
  agentCount: 3,
  autonomyEnabled: false,
  budget: 25,
  computerUseEnabled: true,
  computerUseSessionMode: 'logged_out',
  customRoleModels: { planner: 'gpt-5' },
  quickModeEnabled: true,
  setAutonomyEnabled: vi.fn(),
  setComputerUseEnabled: vi.fn(),
  setComputerUseSessionMode: vi.fn(),
  setCustomRoleModels: vi.fn(),
  setQuickModeEnabled: vi.fn(),
});

const makeViewState = () => ({
  controlsDisabled: false,
  interactionsDisabled: false,
  modelSelectorDisabled: false,
  primaryAction: { mode: 'send' },
});

const makeOptions = (overrides: Partial<Parameters<typeof usePromptFormController>[0]> = {}) => ({
  clearErrorMessage: vi.fn(),
  ensureConversationId: vi.fn(async () => 'conversation-1'),
  initialModelSelector: null,
  isDisabled: false,
  mcpToolItems: [],
  ...overrides,
});

describe('usePromptFormController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tauriInvokeMock.mockImplementation(async (command: string) => {
      if (command === 'app_server_auth_status') {
        return {
          authenticated: true,
        };
      }
      if (command === 'app_server_voice_transcribe') {
        return { text: 'voice text' };
      }
      return undefined;
    });
    Object.defineProperty(window, '__TAURI__', {
      configurable: true,
      value: {
        invoke: tauriInvokeMock,
      },
    });
    useTranslationMock.mockReturnValue({
      t: (_key: string, fallback: string) => fallback,
    });
    useAuthMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      user: { email: 'user@example.com', plan: 'pro' },
    });
    useStreamingMock.mockReturnValue({
      isStreaming: false,
      errorMessage: '',
      setErrorMessage: vi.fn(),
      prepareStreaming: vi.fn(),
      failPreparedStreaming: vi.fn(),
      startStreaming: vi.fn(),
      cancelStreaming: vi.fn(),
      currentSpend: 4,
      budgetLimit: 50,
    });
    useProjectsMock.mockReturnValue({ activeProjectId: 'project-1' });
    useConversationStoreMock.mockReturnValue({ enqueuePrompt: vi.fn() });
    usePlatformRuntimeMock.mockReturnValue('desktop');
    useStorageAdapterMock.mockReturnValue({
      getItem: vi.fn(async () => null),
      removeItem: vi.fn(async () => undefined),
      setItem: vi.fn(async () => undefined),
    });
    useMobileViewportMock.mockReturnValue(false);
    useFileAttachmentsMock.mockReturnValue({
      error: '',
      files: [{ id: 'file-1' }],
      addFile: vi.fn(),
      clearFiles: vi.fn(),
      removeFile: vi.fn(),
    });
    useVoiceControlMock.mockReturnValue({
      isListening: false,
      acceptVoiceInput: vi.fn(),
      cancelVoiceInput: vi.fn(),
      handleVoiceButtonClick: vi.fn(),
    });
    useRealtimeVoiceSessionMock.mockReturnValue({
      endedDurationMs: null,
      isActive: false,
      isCapturing: false,
      isPlaying: false,
      messages: [],
      status: 'disconnected',
      connect: vi.fn(),
      disconnect: vi.fn(),
      prewarm: vi.fn(),
    });
    useLockedComputerUseStatusMock.mockReturnValue({
      lockedComputerUseStatus: { requiresInstall: false },
      toggleLockedComputerUse: vi.fn(),
    });
    usePromptFormPreferencesMock.mockReturnValue(makePreferences());
    usePromptFormViewStateMock.mockReturnValue(makeViewState());
    usePromptModeBadgesMock.mockReturnValue([{ label: 'Quick' }]);
    usePromptModelSelectorMock.mockReturnValue({
      currentModelLabel: 'GPT-5',
      effectiveModelId: 'gpt-5',
      filteredModelOptions: [{ id: 'gpt-5', label: 'GPT-5' }],
      handleModelSelect: vi.fn(),
      modelOptions: [{ id: 'gpt-5', label: 'GPT-5' }],
      modelSelectorEnabled: true,
      modelSelectorLoading: false,
    });
    usePromptTextareaAutofocusMock.mockReturnValue(undefined);
    useWebPromptSubmissionMock.mockReturnValue({
      loading: false,
      handleSubmit: vi.fn(),
    });
  });

  afterEach(() => {
    restoreFetch();
    restoreTauri();
  });

  it('wires prompt state, attachments, and streaming options into submission', () => {
    const onSendMessage = vi.fn();
    const onConversationId = vi.fn();
    const onLocalCommand = vi.fn();
    const onMcpApproval = vi.fn();

    const { result } = renderHook(() =>
      usePromptFormController(
        makeOptions({
          mcpToolItems: [{ serverName: 'local', name: 'list_files' }] as any,
          onConversationId,
          onLocalCommand,
          onMcpApproval,
          onSendMessage,
          privateChat: true,
          promptValue: 'Summarize this',
        })
      )
    );

    const submissionOptions = useWebPromptSubmissionMock.mock.calls.at(-1)?.[0];
    expect(result.current.prompt).toBe('Summarize this');
    expect(submissionOptions).toMatchObject({
      prompt: 'Summarize this',
      activeProjectId: 'project-1',
      computerUseEnabled: true,
      computerUseTarget: 'virtual',
      privateChat: true,
      quickModeEnabled: true,
      role_models: { planner: 'gpt-5' },
      selectedModelId: 'gpt-5',
      userPlan: 'pro',
    });
    expect(submissionOptions.files).toEqual([{ id: 'file-1' }]);
    expect(submissionOptions.mcpToolItems).toEqual([{ serverName: 'local', name: 'list_files' }]);
    expect(submissionOptions.onConversationId).toBe(onConversationId);
    expect(submissionOptions.onLocalCommand).toBe(onLocalCommand);
    expect(submissionOptions.onMcpApproval).toBe(onMcpApproval);
    expect(submissionOptions.onSendMessage).toBe(onSendMessage);
  });

  it('does not queue retry prompts when message persistence is disabled', async () => {
    const conversationStore = { enqueuePrompt: vi.fn(async () => undefined) };
    useConversationStoreMock.mockReturnValue(conversationStore);

    renderHook(() => usePromptFormController(makeOptions({ persistMessages: false })));

    const submissionOptions = useWebPromptSubmissionMock.mock.calls.at(-1)?.[0];
    expect(() =>
      submissionOptions.enqueuePrompt('private-1', 'keep local', {
        prompt: 'keep local',
      })
    ).toThrow('Private chat does not save prompts for retry.');
    expect(conversationStore.enqueuePrompt).not.toHaveBeenCalled();
  });

  it('forwards attachment errors to streaming error state', async () => {
    const setErrorMessage = vi.fn();
    useStreamingMock.mockReturnValue({
      ...useStreamingMock(),
      setErrorMessage,
    });
    useFileAttachmentsMock.mockReturnValue({
      error: 'Upload failed',
      files: [],
      addFile: vi.fn(),
      clearFiles: vi.fn(),
      removeFile: vi.fn(),
    });

    renderHook(() => usePromptFormController(makeOptions()));

    await waitFor(() => {
      expect(setErrorMessage).toHaveBeenCalledWith('Upload failed');
    });
  });

  it('turns an accepted large paste into a text attachment', () => {
    const addFile = vi.fn();
    useFileAttachmentsMock.mockReturnValue({
      error: '',
      files: [],
      addFile,
      clearFiles: vi.fn(),
      removeFile: vi.fn(),
    });
    const { result } = renderHook(() => usePromptFormController(makeOptions()));
    const content = 'a'.repeat(10_001);

    let accepted = false;
    act(() => {
      accepted = result.current.handleLargePaste(content);
    });

    expect(accepted).toBe(true);
    expect(addFile).toHaveBeenCalledTimes(1);
    const file = addFile.mock.calls[0]?.[0] as File;
    expect(file.name).toBe('Pasted text.txt');
    expect(file.type).toBe('text/plain');
    expect(file.size).toBe(content.length);
  });

  it('keeps a large paste in the text field when no attachment slot remains', () => {
    const addFile = vi.fn();
    useFileAttachmentsMock.mockReturnValue({
      error: '',
      files: Array.from(
        { length: 5 },
        (_, index) => new File(['file'], `file-${index}.txt`, { type: 'text/plain' })
      ),
      addFile,
      clearFiles: vi.fn(),
      removeFile: vi.fn(),
    });
    const { result } = renderHook(() => usePromptFormController(makeOptions()));

    expect(result.current.handleLargePaste('a'.repeat(10_001))).toBe(false);
    expect(addFile).not.toHaveBeenCalled();
  });

  it('restores a generated paste attachment to the prompt', () => {
    const removeFile = vi.fn();
    const pastedFile = createLargePasteAttachment('restored paste');
    useFileAttachmentsMock.mockReturnValue({
      error: '',
      files: [pastedFile],
      addFile: vi.fn(),
      clearFiles: vi.fn(),
      removeFile,
    });
    const { result } = renderHook(() => usePromptFormController(makeOptions()));

    act(() => {
      result.current.setPrompt('Prompt: ');
    });
    act(() => {
      result.current.handleShowAttachmentInTextField(0);
    });

    expect(removeFile).toHaveBeenCalledWith(0);
    expect(result.current.prompt).toBe('Prompt: restored paste');
  });

  it('cancels streaming instead of submitting keyboard, button, and form events', () => {
    const cancelStreaming = vi.fn();
    const handleSubmit = vi.fn();
    useStreamingMock.mockReturnValue({
      ...useStreamingMock(),
      isStreaming: true,
      cancelStreaming,
    });
    useWebPromptSubmissionMock.mockReturnValue({
      loading: false,
      handleSubmit,
    });

    const { result } = renderHook(() => usePromptFormController(makeOptions()));
    const keyboardEvent = {
      key: 'Enter',
      preventDefault: vi.fn(),
      shiftKey: false,
    };
    const clickEvent = { preventDefault: vi.fn() };
    const formEvent = { preventDefault: vi.fn() };

    act(() => {
      result.current.handleKeyDown(keyboardEvent as any);
      result.current.handlePrimaryButtonClick(clickEvent as any);
      result.current.handleSubmit(formEvent as any);
    });

    expect(keyboardEvent.preventDefault).toHaveBeenCalled();
    expect(clickEvent.preventDefault).toHaveBeenCalled();
    expect(formEvent.preventDefault).toHaveBeenCalled();
    expect(cancelStreaming).toHaveBeenCalledTimes(2);
    expect(handleSubmit).not.toHaveBeenCalled();
  });

  it('starts desktop dictation with Ctrl-M', () => {
    const handleVoiceButtonClick = vi.fn();
    const handleSubmit = vi.fn();
    useVoiceControlMock.mockReturnValue({
      isListening: false,
      acceptVoiceInput: vi.fn(),
      cancelVoiceInput: vi.fn(),
      handleVoiceButtonClick,
    });
    useWebPromptSubmissionMock.mockReturnValue({
      loading: false,
      handleSubmit,
    });

    const { result } = renderHook(() => usePromptFormController(makeOptions()));
    const keyboardEvent = {
      altKey: false,
      ctrlKey: true,
      key: 'm',
      metaKey: false,
      preventDefault: vi.fn(),
    };

    act(() => {
      result.current.handleKeyDown(keyboardEvent as any);
    });

    expect(keyboardEvent.preventDefault).toHaveBeenCalled();
    expect(handleVoiceButtonClick).toHaveBeenCalledTimes(1);
    expect(handleSubmit).not.toHaveBeenCalled();
  });

  it('starts web dictation with Ctrl-Shift-D', () => {
    const handleVoiceButtonClick = vi.fn();
    const handleSubmit = vi.fn();
    usePlatformRuntimeMock.mockReturnValue('browser');
    useVoiceControlMock.mockReturnValue({
      isListening: false,
      acceptVoiceInput: vi.fn(),
      cancelVoiceInput: vi.fn(),
      handleVoiceButtonClick,
    });
    useWebPromptSubmissionMock.mockReturnValue({
      loading: false,
      handleSubmit,
    });

    const { result } = renderHook(() => usePromptFormController(makeOptions()));
    const keyboardEvent = {
      altKey: false,
      ctrlKey: true,
      key: 'D',
      metaKey: false,
      preventDefault: vi.fn(),
      shiftKey: true,
    };

    act(() => {
      result.current.handleKeyDown(keyboardEvent as any);
    });

    expect(keyboardEvent.preventDefault).toHaveBeenCalled();
    expect(handleVoiceButtonClick).toHaveBeenCalledTimes(1);
    expect(handleSubmit).not.toHaveBeenCalled();
  });

  it('starts web realtime voice with Ctrl-Shift-V', () => {
    const connect = vi.fn();
    const handleSubmit = vi.fn();
    usePlatformRuntimeMock.mockReturnValue('browser');
    useRealtimeVoiceSessionMock.mockReturnValue({
      endedDurationMs: null,
      isActive: false,
      isCapturing: false,
      isPlaying: false,
      messages: [],
      status: 'disconnected',
      connect,
      disconnect: vi.fn(),
      prewarm: vi.fn(),
    });
    useWebPromptSubmissionMock.mockReturnValue({
      loading: false,
      handleSubmit,
    });

    const { result } = renderHook(() => usePromptFormController(makeOptions()));
    const keyboardEvent = {
      altKey: false,
      ctrlKey: true,
      key: 'v',
      metaKey: false,
      preventDefault: vi.fn(),
      shiftKey: true,
    };

    act(() => {
      result.current.handleKeyDown(keyboardEvent as any);
    });

    expect(keyboardEvent.preventDefault).toHaveBeenCalled();
    expect(connect).toHaveBeenCalledTimes(1);
    expect(handleSubmit).not.toHaveBeenCalled();
  });

  it('opens the web model selector with Ctrl-Shift-M', () => {
    const click = vi.fn();
    const handleSubmit = vi.fn();
    usePlatformRuntimeMock.mockReturnValue('browser');
    useWebPromptSubmissionMock.mockReturnValue({
      loading: false,
      handleSubmit,
    });

    const { result } = renderHook(() => usePromptFormController(makeOptions()));
    act(() => {
      result.current.modelSelectorTriggerRef.current = {
        click,
      } as unknown as HTMLButtonElement;
    });

    const keyboardEvent = {
      altKey: false,
      code: 'KeyM',
      ctrlKey: true,
      key: 'µ',
      metaKey: false,
      preventDefault: vi.fn(),
      shiftKey: true,
    };

    act(() => {
      result.current.handleKeyDown(keyboardEvent as any);
    });

    expect(keyboardEvent.preventDefault).toHaveBeenCalled();
    expect(click).toHaveBeenCalledTimes(1);
    expect(handleSubmit).not.toHaveBeenCalled();
  });

  it('ignores ordinary non-submit keydown events', () => {
    const handleSubmit = vi.fn();
    useWebPromptSubmissionMock.mockReturnValue({
      loading: false,
      handleSubmit,
    });

    const { result } = renderHook(() => usePromptFormController(makeOptions()));
    const keyboardEvent = {
      altKey: false,
      ctrlKey: false,
      key: 'a',
      metaKey: false,
      preventDefault: vi.fn(),
      shiftKey: false,
    };

    act(() => {
      result.current.handleKeyDown(keyboardEvent as any);
    });

    expect(keyboardEvent.preventDefault).not.toHaveBeenCalled();
    expect(handleSubmit).not.toHaveBeenCalled();
  });

  it('switches local computer-use target unless desktop installation is required', () => {
    const toggleLockedComputerUse = vi.fn();
    useLockedComputerUseStatusMock.mockReturnValue({
      lockedComputerUseStatus: { requiresInstall: true },
      toggleLockedComputerUse,
    });
    const first = renderHook(() => usePromptFormController(makeOptions()));

    act(() => {
      first.result.current.toggleLockedComputerUse();
    });

    expect(toggleLockedComputerUse).toHaveBeenCalledTimes(1);
    expect(first.result.current.computerUseTarget).toBe('virtual');
    first.unmount();

    useLockedComputerUseStatusMock.mockReturnValue({
      lockedComputerUseStatus: { requiresInstall: false },
      toggleLockedComputerUse,
    });
    const second = renderHook(() => usePromptFormController(makeOptions()));

    act(() => {
      second.result.current.toggleLockedComputerUse();
    });
    expect(second.result.current.computerUseTarget).toBe('local');

    act(() => {
      second.result.current.toggleLockedComputerUse();
    });
    expect(second.result.current.computerUseTarget).toBe('virtual');
  });

  it('updates prompt state for MCP tools, dictation transcripts, and prompt templates', async () => {
    let audioCaptureFileHandler: ((file: File) => Promise<void>) | undefined;
    useVoiceControlMock.mockImplementation((options) => {
      audioCaptureFileHandler = options.onAudioCaptureFile;
      return {
        isListening: false,
        acceptVoiceInput: vi.fn(),
        cancelVoiceInput: vi.fn(),
        handleVoiceButtonClick: vi.fn(),
      };
    });
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response(JSON.stringify({ text: 'voice text' }), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      });
    });
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: fetchMock,
      writable: true,
    });

    const { result } = renderHook(() => usePromptFormController(makeOptions()));

    await act(async () => {
      result.current.setPrompt('Use');
      await audioCaptureFileHandler?.(
        new File(['audio'], 'voice-recording.webm', { type: 'audio/webm' })
      );
    });
    expect(result.current.prompt).toBe('Use voice text');
    expect(useVoiceControlMock.mock.calls.at(-1)?.[0]).toMatchObject({
      mode: 'audio',
    });
    expect(tauriInvokeMock).not.toHaveBeenCalledWith('app_server_auth_status', undefined);
    expect(tauriInvokeMock).toHaveBeenCalledWith('app_server_voice_transcribe', {
      params: {
        audioBase64: 'YXVkaW8=',
        fileName: 'voice-recording.webm',
        mediaType: 'audio/webm',
      },
    });
    expect(fetchMock).not.toHaveBeenCalled();

    act(() => {
      result.current.handleInsertMcpTool('filesystem', 'read_file');
    });
    expect(result.current.prompt).toContain('/mcp');
    expect(result.current.prompt).toContain('filesystem');
    expect(result.current.prompt).toContain('read_file');

    const template = result.current.promptTemplates.find(
      (item) => item.id === 'investment-dossier'
    );
    if (!template) {
      throw new Error('Expected investment dossier template');
    }

    act(() => {
      result.current.handleInsertPromptTemplate(template);
    });

    expect(result.current.prompt).toContain('Create an investment dossier');
    expect(result.current.selectedResearchWorkflow?.workflow).toBe('investment_dossier');
  });

  it('starts realtime voice and blocks prompt submission while active', () => {
    const connect = vi.fn();
    useRealtimeVoiceSessionMock.mockReturnValue({
      endedDurationMs: null,
      isActive: true,
      isCapturing: false,
      isPlaying: false,
      messages: [],
      status: 'connected',
      connect,
      disconnect: vi.fn(),
      prewarm: vi.fn(),
    });

    const { result } = renderHook(() => usePromptFormController(makeOptions()));

    act(() => {
      result.current.handleRealtimeVoiceClick();
    });

    const submissionOptions = useWebPromptSubmissionMock.mock.calls.at(-1)?.[0];
    expect(connect).toHaveBeenCalledTimes(1);
    expect(submissionOptions.isListening).toBe(true);
    expect(result.current.promptSubmissionBlockedByVoice).toBe(true);
  });

  it('prewarms realtime voice setup through the returned handler', () => {
    const prewarm = vi.fn();
    useRealtimeVoiceSessionMock.mockReturnValue({
      endedDurationMs: null,
      isActive: false,
      isCapturing: false,
      isPlaying: false,
      messages: [],
      status: 'disconnected',
      connect: vi.fn(),
      disconnect: vi.fn(),
      prewarm,
    });

    const { result } = renderHook(() => usePromptFormController(makeOptions()));

    act(() => {
      result.current.handleRealtimeVoicePrewarm();
    });

    expect(prewarm).toHaveBeenCalledTimes(1);
  });

  it('does not start or prewarm realtime voice in private chat', () => {
    const connect = vi.fn();
    const prewarm = vi.fn();
    useRealtimeVoiceSessionMock.mockReturnValue({
      endedDurationMs: null,
      isActive: false,
      isCapturing: false,
      isPlaying: false,
      messages: [],
      status: 'disconnected',
      connect,
      disconnect: vi.fn(),
      prewarm,
    });

    const { result } = renderHook(() =>
      usePromptFormController(makeOptions({ privateChat: true }))
    );

    act(() => {
      result.current.handleRealtimeVoiceClick();
      result.current.handleRealtimeVoicePrewarm();
      result.current.handleKeyDown({
        ctrlKey: true,
        shiftKey: true,
        metaKey: false,
        altKey: false,
        key: 'v',
        code: 'KeyV',
        preventDefault: vi.fn(),
      } as any);
    });

    expect(connect).not.toHaveBeenCalled();
    expect(prewarm).not.toHaveBeenCalled();
  });

  it('does not start or prewarm realtime voice in Work mode', () => {
    const connect = vi.fn();
    const disconnect = vi.fn();
    const prewarm = vi.fn();
    useRealtimeVoiceSessionMock.mockReturnValue({
      endedDurationMs: null,
      isActive: true,
      isCapturing: false,
      isPlaying: false,
      messages: [],
      status: 'disconnected',
      connect,
      disconnect,
      prewarm,
    });

    const { result } = renderHook(() =>
      usePromptFormController(makeOptions({ desktopTaskMode: 'work' }))
    );

    act(() => {
      result.current.handleRealtimeVoiceClick();
      result.current.handleRealtimeVoicePrewarm();
    });

    expect(connect).not.toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(prewarm).not.toHaveBeenCalled();
  });

  it('opens orchestration surfaces through returned handlers and mode badges', () => {
    let openOrchestration: (() => void) | undefined;
    let openAutonomousPanel: (() => void) | undefined;
    usePromptModeBadgesMock.mockImplementation((options) => {
      openOrchestration = options.onOpenOrchestration;
      openAutonomousPanel = options.onOpenAutonomousPanel;
      return [];
    });

    const { result } = renderHook(() => usePromptFormController(makeOptions()));

    act(() => {
      openOrchestration?.();
      openAutonomousPanel?.();
    });

    expect(result.current.isOrchestrationModalOpen).toBe(true);
    expect(result.current.isAutonomousPanelOpen).toBe(true);

    act(() => {
      result.current.setIsOrchestrationModalOpen(false);
      result.current.openOrchestrationModal();
    });

    expect(loggerDebugMock).toHaveBeenCalledWith('Opening Orchestration Modal');
    expect(result.current.isOrchestrationModalOpen).toBe(true);
  });
});
