import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'bun:test';

import '../../../../../tests/setup/dom';
import { installWebBunComponentMocks } from '../../../../../tests/setup/web-bun-component-mocks';

installWebBunComponentMocks();

let PromptForm: typeof import('./PromptForm').default;
const originalFetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');

const restoreFetch = () => {
  if (originalFetchDescriptor) {
    Object.defineProperty(globalThis, 'fetch', originalFetchDescriptor);
    return;
  }
  Reflect.deleteProperty(globalThis, 'fetch');
};

// Mocks
void vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, def: string) => def }),
}));

// Stable stable
const mockConversationStore = { enqueuePrompt: vi.fn() };
void vi.mock('../../lib/platform/PlatformProvider', () => ({
  useConversationStore: () => mockConversationStore,
  usePlatformRuntime: () => 'browser',
}));

void vi.mock('../../lib/platform/desktop-api', () => ({
  callDesktopMcpTool: vi.fn(),
  captureDesktopWorkspaceCheckpoint: vi.fn(async () => ({})),
  createVoiceGatewayRequestOptions: vi.fn(async () => ({})),
  createDesktopRecordReplaySkill: vi.fn(),
  disableDesktopLocalCoding: vi.fn(),
  enableDesktopLocalCoding: vi.fn(),
  executeDesktopAppServerCommand: vi.fn(),
  getDesktopAppServerAuthStatus: vi.fn(),
  getDesktopAppServerComputerUseMode: vi.fn(async () => ({ enabled: false })),
  getDesktopAppServerContextSummary: vi.fn(async () => ({
    totalTokens: 0,
    contextWindow: 0,
  })),
  inspectDesktopMcpServer: vi.fn(),
  invokeTauri: vi.fn(),
  listDesktopAppServerModels: vi.fn(),
  listDesktopAppServerPlugins: vi.fn(),
  observeDesktopComputerUse: vi.fn(),
  openDesktopBrowserPreview: vi.fn(),
  setDesktopAppServerPluginEnabled: vi.fn(),
  setDesktopAppServerComputerUseMode: vi.fn(async (enabled: boolean) => ({ enabled })),
  showDesktopBrowserPreview: vi.fn(),
  submitDesktopAppServerRun: vi.fn(),
  updateDesktopAppServerLocalSettings: vi.fn(),
  waitForTauriBridge: vi.fn(async () => {}),
}));

const mockAuth = {
  isAuthenticated: true,
  isLoading: false,
  user: {
    plan: 'pro',
    email: 'test@example.com',
    full_name: 'Test User',
    quick_mode_enabled: false,
  },
};
void vi.mock('../../lib/providers/AuthProvider', () => ({
  useAuth: () => mockAuth,
}));

const mockFetchAgents = vi.fn<any>(async () => ({ ok: true, value: [] }));
const mockUpsertAgent = vi.fn(async () => ({
  ok: true,
  value: { id: 'agent-1', name: 'Agent 1' },
}));
void vi.mock('../../lib/api/agents', () => ({
  fetchAgents: mockFetchAgents,
  upsertAgent: mockUpsertAgent,
}));

void vi.mock('../../lib/models/model-selector', () => ({
  loadModelOptions: vi.fn(async () => ({
    ok: true,
    value: {
      enabled: true,
      options: [],
      defaultModelId: 'gpt-4',
    },
  })),
}));

void vi.mock('../../lib/prompt/model-selection', () => ({
  readStoredModelSelection: () => ({ id: 'gpt-4', label: 'GPT-4' }),
  persistModelSelection: vi.fn(),
}));

void vi.mock('@taskforceai/react-core', () => {
  const React = require('react') as typeof import('react');
  const normalizeMcpServers = <
    TServer extends { enabled?: boolean; endpoint: string; name: string },
  >(
    servers: TServer[]
  ): TServer[] => {
    const normalized = new Map<string, TServer>();

    for (const server of servers) {
      const name = server.name.trim();
      const endpoint = server.endpoint.trim();
      if (!name || !endpoint) {
        continue;
      }
      normalized.set(name.toLowerCase(), {
        ...server,
        endpoint,
        name,
        enabled: server.enabled,
      });
    }

    return [...normalized.values()];
  };

  const parseStoredMcpServers = (raw: string | null) => {
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return normalizeMcpServers(
      parsed.map((value) => {
        const item = value as { enabled?: unknown; endpoint?: unknown; name?: unknown } | null;
        return {
          endpoint: typeof item?.endpoint === 'string' ? item.endpoint : '',
          name: typeof item?.name === 'string' ? item.name : '',
          enabled: item?.enabled !== false,
        };
      })
    );
  };

  return {
    buildOrchestrationConfig: (config: unknown) => config,
    applyStoredOrchestrationConfig: vi.fn(),
    configureLogger: vi.fn(),
    appendLocalAssistantMessage: async (
      persistence: {
        ensureConversationId: () => Promise<string>;
        persistMessage: (_message: Record<string, unknown>) => Promise<void>;
        setMessages: React.Dispatch<React.SetStateAction<Record<string, unknown>[]>>;
      },
      content: string,
      options: { isLocalCommandOutput?: boolean } = {}
    ) => {
      const conversationId = await persistence.ensureConversationId();
      const now = Date.now();
      const messageId = `assistant-${now}`;
      const message = {
        id: messageId,
        role: 'assistant',
        content,
        sources: [],
        toolEvents: [],
        createdAt: now,
        updatedAt: now,
        ...(options.isLocalCommandOutput ? { isLocalCommandOutput: true } : {}),
      };
      persistence.setMessages((previous) => [...previous, message]);
      await persistence.persistMessage({
        conversationId,
        messageId,
        role: 'assistant',
        content,
        isStreaming: false,
        createdAt: now,
        updatedAt: now,
        ...(options.isLocalCommandOutput ? { isLocalCommandOutput: true } : {}),
      });
    },
    handleLocalMcpCommandCore: vi.fn(async () => ({ handled: false })),
    normalizeMcpServers,
    parseStoredMcpServers,
    resolveEnabledMcpServer: vi.fn(async () => {
      throw new Error('MCP server not found.');
    }),
    serializeStoredMcpServers: (
      servers: { enabled?: boolean; endpoint: string; name: string }[]
    ) => {
      const normalized = normalizeMcpServers(servers);
      return normalized.length > 0 ? JSON.stringify(normalized) : null;
    },
    useHydratedAsyncModelSelector: () => ({
      modelOptions: [],
      modelSelectorEnabled: true,
      effectiveModelId: 'gpt-4',
      currentModelLabel: 'GPT-4',
      handleModelSelect: vi.fn(),
      modelSelectorLoading: false,
    }),
    usePersistedOrchestrationConfig: () => ({ isHydrated: true }),
    usePromptSubmission: (props: any) => ({
      loading: false,
      handleSubmit: async (event?: { preventDefault?: () => void }) => {
        event?.preventDefault?.();
        const trimmedPrompt = props.prompt.trim();
        if (!trimmedPrompt && props.files.length === 0) {
          return;
        }
        props.clearErrorMessage();
        const attachmentIds = await Promise.all(
          props.files.map((file: File) => props.uploadAttachment(file))
        );
        const conversationId = await props.ensureConversationId();
        await props.submitPrompt({
          prompt: trimmedPrompt,
          attachment_ids: attachmentIds,
          conversationId,
          modelId: props.modelSelectorEnabled ? props.selectedModelId : null,
          quickModeEnabled: props.quickModeEnabled,
          computerUseEnabled: props.computerUseEnabled,
          useLoggedInServices: props.useLoggedInServices,
          role_models: props.role_models,
          budget: props.budget,
          agentCount: props.agentCount,
          researchWorkflow: props.researchWorkflow,
        });
        props.resetFormState();
      },
    }),
    useFileAttachments: () => {
      const [files, setFiles] = React.useState<File[]>([]);
      const [isDraggingFiles, setIsDraggingFiles] = React.useState(false);
      const fileInputRef = React.useRef<HTMLInputElement | null>(null);
      return {
        files,
        error: null,
        isDraggingFiles,
        fileInputRef,
        handleFileChange: vi.fn(),
        handleDragOver: (event: React.DragEvent<HTMLElement>) => {
          event.preventDefault();
          setIsDraggingFiles(true);
        },
        handleDragLeave: () => setIsDraggingFiles(false),
        handleDrop: (event: React.DragEvent<HTMLElement>) => {
          event.preventDefault();
          setIsDraggingFiles(false);
          setFiles((previous) => [...previous, ...Array.from(event.dataTransfer.files)]);
        },
        addFile: (file: File) => setFiles((previous) => [...previous, file]),
        addFiles: (newFiles: File[]) => setFiles((previous) => [...previous, ...newFiles]),
        removeFile: (index: number) =>
          setFiles((previous) => previous.filter((_, itemIndex) => itemIndex !== index)),
        clearFiles: () => setFiles([]),
        triggerFileDialog: vi.fn(),
      };
    },
    useVoiceControl: ({
      onTranscript,
      onAudioCaptureFile,
      mode,
    }: {
      onTranscript?: (_text: string) => void;
      onAudioCaptureFile?: (_file: File) => void;
      mode?: 'transcript' | 'audio';
    }) => {
      const [isListening, setIsListening] = React.useState(false);
      return {
        isListening,
        acceptVoiceInput: async () => {
          setIsListening(false);
        },
        cancelVoiceInput: async () => {
          setIsListening(false);
        },
        handleVoiceButtonClick: async () => {
          setIsListening(true);
          try {
            if (mode === 'audio' && onAudioCaptureFile) {
              const audio = await mockVoice.manager.record();
              onAudioCaptureFile(
                new File([], `voice-recording.${audio.format}`, { type: `audio/${audio.format}` })
              );
            } else {
              const transcript = await mockVoice.manager.listen();
              onTranscript?.(transcript);
            }
          } finally {
            setIsListening(false);
          }
        },
      };
    },
  };
});

const mockStreaming = {
  isStreaming: false,
  startStreaming: vi.fn(),
  cancelStreaming: vi.fn(),
  setErrorMessage: vi.fn(),
  errorMessage: null,
  rateLimitResetTime: null,
  currentSpend: 0,
  budgetLimit: null,
};
void vi.mock('../../lib/providers/StreamingProvider', () => ({
  useStreaming: () => mockStreaming,
}));

const autonomousPanelSpy = vi.fn();
void vi.mock('./prompt-form/orchestration/AutonomousPanel', () => ({
  AutonomousPanel: (props: any) => {
    autonomousPanelSpy(props);
    return <div data-testid="autonomous-panel" />;
  },
}));

const mockVoice = {
  manager: { cancel: vi.fn(), init: vi.fn(), listen: vi.fn(), record: vi.fn() },
  error: null,
};
void vi.mock('@taskforceai/voice', () => ({
  isVoiceCancellationError: () => false,
}));

void vi.mock('@taskforceai/react-core/useVoice', () => ({
  useVoice: () => mockVoice,
}));

// Mock ProjectsContext (used by usePromptSubmission)
void vi.mock('../../lib/projects/ProjectsContext', () => ({
  useProjects: vi.fn(() => ({
    projects: [],
    activeProjectId: null,
    setActiveProjectId: vi.fn(),
    isLoading: false,
    isModalOpen: false,
    setModalOpen: vi.fn(),
    refreshProjects: vi.fn(),
    createProject: vi.fn(),
    deleteProject: vi.fn(),
  })),
}));

// Mock prompt submission helpers
void vi.mock('../../lib/prompt/prompt-submission', () => ({
  getRateLimitMessage: () => 'Rate limit exceeded',
  getRateLimitResetTime: () => 0,
}));

const mockSubmitPrompt = vi.fn(async () => ({
  ok: true as const,
  value: { type: 'streaming_started' as const },
}));
void vi.mock('../../lib/prompt/submit-prompt', () => ({
  submitPrompt: mockSubmitPrompt,
}));

// Mock ModelSelectorControl
void vi.mock('../../lib/prompt/ModelSelectorControl', () => ({
  ModelSelectorControl: () => <div data-testid="model-selector">Selector</div>,
}));

void vi.mock('./prompt-form/composer/AutoResizingTextarea', () => ({
  AutoResizingTextarea: ({
    value,
    onValueChange,
    onEnterPress,
    onKeyDown,
    minHeight: _minHeight,
    ...props
  }: any) => {
    const syncValue = (event: { target: { value: string } }) => onValueChange(event.target.value);

    return (
      <textarea
        {...props}
        value={value}
        onInput={syncValue}
        onChange={syncValue}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (!event.defaultPrevented && event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            onEnterPress?.(event);
          }
        }}
      />
    );
  },
}));

void vi.mock('./prompt-form/orchestration/OrchestrationModal', () => ({
  OrchestrationModal: ({ isOpen }: any) =>
    isOpen ? <div data-testid="orchestration-modal" /> : null,
}));

void vi.mock('../../lib/hooks/useMobileViewport', () => ({
  useMobileViewport: () => false,
}));

// Mock feature flags
void vi.mock('@taskforceai/feature-flags', () => ({
  useFeatureFlag: () => true,
  FEATURE_FLAGS: {
    MODE_COMPUTER_USE: 'mode-computer-use',
    MODE_AUTONOMY: 'mode-autonomy',
    MODE_QUICK: 'mode-quick',
    MODE_IMAGE_GEN: 'mode-image-gen',
  },
}));

describe('PromptForm', () => {
  const defaultProps = {
    clearErrorMessage: vi.fn(),
    ensureConversationId: vi.fn().mockResolvedValue('conv-123'),
  };

  beforeAll(async () => {
    ({ default: PromptForm } = await import('./PromptForm'));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: vi.fn(async () => {
        return new Response(JSON.stringify({ text: 'hello from voice' }), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        });
      }),
      writable: true,
    });
    mockAuth.isAuthenticated = true;
    mockAuth.isLoading = false;
    mockStreaming.isStreaming = false;
    mockFetchAgents.mockResolvedValue({ ok: true, value: [] });
    mockUpsertAgent.mockResolvedValue({ ok: true, value: { id: 'agent-1', name: 'Agent 1' } });
    mockVoice.manager.listen.mockResolvedValue('hello from voice');
    mockVoice.manager.record.mockResolvedValue({
      data: 'QQ==',
      format: 'wav',
    });
    mockSubmitPrompt.mockResolvedValue({
      ok: true as const,
      value: { type: 'streaming_started' as const },
    });
  });

  afterEach(() => {
    cleanup();
    restoreFetch();
  });

  it('renders input area', () => {
    render(<PromptForm {...defaultProps} />);
    expect(screen.getByRole('textbox')).toBeTruthy();
    expect(screen.getByTitle('Dictate ^⇧D')).toBeTruthy();
    expect(screen.getByTitle('Use Voice ^⇧V')).toBeTruthy();
  });

  it('updates input on change', () => {
    render(<PromptForm {...defaultProps} />);
    const input = screen.getByRole('textbox');
    fireEvent.input(input, { target: { value: 'Test' } });
    expect((input as HTMLTextAreaElement).value).toBe('Test');
  });

  it('expands the composer layout for long prompts', async () => {
    render(<PromptForm {...defaultProps} />);
    const input = screen.getByRole('textbox');
    const form = screen.getByRole('form', { name: 'Prompt submission form' });

    fireEvent.input(input, {
      target: {
        value:
          'Use computer use only. Do not use code execution. Take an initial screenshot, try to open a terminal, type a command, and take a final screenshot showing the result.',
      },
    });

    await waitFor(() => expect(form.className).toContain('prompt-form--expanded'));
  });

  it('removes more options and keeps computer use disabled by default', async () => {
    render(<PromptForm {...defaultProps} />);

    expect(screen.queryByTitle('Mode Options')).toBeNull();

    const input = screen.getByRole('textbox');
    fireEvent.input(input, { target: { value: 'Take a screenshot.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() =>
      expect(mockSubmitPrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          computerUseEnabled: false,
        })
      )
    );
  });

  it('keeps signed-out prompt copy hidden while auth is loading', () => {
    mockAuth.isAuthenticated = false;
    mockAuth.isLoading = true;

    render(<PromptForm {...defaultProps} isDisabled />);

    expect(screen.getByPlaceholderText('How can TaskForce help?')).toBeTruthy();
    expect(screen.queryByText('Sign in to start chatting.')).toBeNull();
    expect(screen.getByTitle('Add files and more')).toBeTruthy();
  });

  it('shows slash command suggestions when prompt starts with slash', async () => {
    render(<PromptForm {...defaultProps} />);
    const input = screen.getByRole('textbox');

    fireEvent.input(input, { target: { value: '/' } });

    expect(await screen.findByRole('listbox', { name: 'Slash commands' })).toBeTruthy();
    expect(screen.getByText('/login')).toBeTruthy();
    expect(screen.getByText('/model')).toBeTruthy();
  });

  it('autocompletes a selected slash command before submit', async () => {
    render(<PromptForm {...defaultProps} />);
    const input = screen.getByRole('textbox');

    fireEvent.input(input, { target: { value: '/mo' } });
    await screen.findByText('/model');
    fireEvent.mouseDown(screen.getByRole('option', { name: /\/model/i }));

    await waitFor(() => expect(input).toHaveValue('/model'));
    expect(mockSubmitPrompt).not.toHaveBeenCalled();
  });

  it('executes an exact slash command on submit', async () => {
    const onLocalCommand = vi.fn(async () => true);
    render(<PromptForm {...defaultProps} onLocalCommand={onLocalCommand} />);
    const input = screen.getByRole('textbox');

    fireEvent.input(input, { target: { value: '/status' } });
    await screen.findByRole('listbox', { name: 'Slash commands' });
    fireEvent.submit(screen.getByRole('form', { name: 'Prompt submission form' }));

    await waitFor(() =>
      expect(onLocalCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: '/status',
          attachmentIds: [],
        })
      )
    );
    expect(mockSubmitPrompt).not.toHaveBeenCalled();
  });

  it('passes streaming state through to autonomous panel', () => {
    mockStreaming.isStreaming = true;
    render(<PromptForm {...defaultProps} />);
    expect(autonomousPanelSpy).toHaveBeenCalledWith(expect.objectContaining({ isStreaming: true }));
  });

  it('turns the primary prompt action into a stop button while streaming', () => {
    mockStreaming.isStreaming = true;
    render(<PromptForm {...defaultProps} />);

    fireEvent.click(screen.getByTitle('Stop run'));

    expect(mockStreaming.cancelStreaming).toHaveBeenCalledTimes(1);
    expect(mockSubmitPrompt).not.toHaveBeenCalled();
  });

  it('does not upsert on initial autonomy hydration', async () => {
    mockFetchAgents.mockResolvedValue({
      ok: true,
      value: [{ id: 'agent-1', name: 'Custom Name', autonomy_enabled: true }],
    });

    render(<PromptForm {...defaultProps} />);

    await waitFor(() => expect(mockFetchAgents).toHaveBeenCalled());
    await waitFor(() => expect(mockUpsertAgent).not.toHaveBeenCalled());
  });

  it('adds dictated voice text to the prompt input through the shared voice hook', async () => {
    render(<PromptForm {...defaultProps} />);

    fireEvent.click(screen.getByTitle('Dictate ^⇧D'));

    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('hello from voice'));
    expect(mockVoice.manager.record).toHaveBeenCalledTimes(1);
  });

  it('uses the Work composer copy and hides realtime voice', () => {
    render(<PromptForm {...defaultProps} desktopTaskMode="work" variant="centered" />);

    expect(screen.getByPlaceholderText('Work on anything')).toBeTruthy();
    expect(screen.queryByTitle('Use Voice ^⇧V')).toBeNull();
    expect(screen.getByRole('form', { name: 'Prompt submission form' }).className).toContain(
      'prompt-form--expanded'
    );
  });

  it('adds dropped files as prompt attachments', async () => {
    render(<PromptForm {...defaultProps} />);
    const form = screen.getByRole('form', { name: 'Prompt submission form' });
    const file = new File(['hello'], 'drop-note.txt', { type: 'text/plain' });

    fireEvent.dragOver(form, {
      dataTransfer: {
        types: ['Files'],
        files: [file],
      },
    });

    await waitFor(() => expect(screen.getByText('Drop files to attach')).toBeTruthy());

    fireEvent.drop(form, {
      dataTransfer: {
        files: [file],
      },
    });

    await waitFor(() => expect(screen.getByText('drop-note.txt')).toBeTruthy());
  });

  it('renders mcp tools and inserts an mcp call command when clicked', () => {
    render(
      <PromptForm
        {...defaultProps}
        showMcpToolCatalog={true}
        mcpToolSummary="MCP tools available: 1 across 1 server."
        mcpToolItems={[
          {
            source: 'mcp',
            serverName: 'docs',
            toolName: 'lookup',
            title: 'Lookup',
            description: 'Search the docs server',
          },
        ]}
      />
    );

    expect(screen.getByText('MCP tools available: 1 across 1 server.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'docs/lookup' }));

    expect(screen.getByRole('textbox')).toHaveValue('/mcp call docs lookup ');
  });

  it('inserts a finance prompt template from the prompts menu', () => {
    render(<PromptForm {...defaultProps} />);

    expect(screen.getByTitle('Add files and more')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Prompts' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Investment dossier/i }));

    const promptInput = screen.getByRole('textbox');
    const value = (promptInput as HTMLTextAreaElement).value;
    expect(value).toContain('Create an investment dossier');
    expect(value).toContain('SEC EDGAR filings');
    expect(value).toContain('Do not rely on paid market-data providers');
    expect(value).toContain('Word and PDF artifacts');
  });

  it('forwards selected research workflow metadata on submit', async () => {
    render(<PromptForm {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: /Investment dossier/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() =>
      expect(mockSubmitPrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          researchWorkflow: {
            workflow: 'investment_dossier',
            requiredCitations: true,
            preferredExports: ['docx', 'pdf'],
            sourcePolicy: 'public_and_attached',
          },
        })
      )
    );
  });

  it('clears research workflow metadata when inserting a non-finance prompt', async () => {
    render(<PromptForm {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: /Investment dossier/i }));
    fireEvent.click(screen.getByRole('button', { name: /Review code/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() =>
      expect(mockSubmitPrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          researchWorkflow: undefined,
        })
      )
    );
    expect(screen.getByRole('textbox')).toHaveValue('');
  });

  it('short-circuits prompt submission when a local command handles the prompt', async () => {
    const onLocalCommand = vi.fn(async () => true);

    render(<PromptForm {...defaultProps} onLocalCommand={onLocalCommand} />);

    const promptInput = screen.getByRole('textbox');
    fireEvent.input(promptInput, { target: { value: '  /local open logs  ' } });
    await waitFor(() => expect(promptInput).toHaveValue('  /local open logs  '));
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() =>
      expect(onLocalCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: '/local open logs',
          attachmentIds: [],
        })
      )
    );
    expect(mockSubmitPrompt).not.toHaveBeenCalled();
  });
});
