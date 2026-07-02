import { beforeEach, describe, expect, it, mock, vi } from 'bun:test';

import { useWebPromptSubmission } from './useWebPromptSubmission';

const usePromptSubmissionMock = vi.fn((config) => config);
const submitPromptMock = vi.fn();
const uploadAttachmentMock = vi.fn();
const getRateLimitMessageMock = vi.fn();
const getRateLimitResetTimeMock = vi.fn();
const submitDesktopAppServerRunMock = vi.fn();
const getDesktopAppServerComputerUseModeMock = vi.fn();
let platformRuntime: 'browser' | 'desktop' = 'browser';

mock.module('@taskforceai/react-core', () => ({
  usePromptSubmission: usePromptSubmissionMock,
}));

mock.module('@taskforceai/contracts/api/tasks', () => ({
  uploadAttachment: uploadAttachmentMock,
}));

mock.module('../../../lib/prompt/prompt-submission', () => ({
  getRateLimitMessage: getRateLimitMessageMock,
  getRateLimitResetTime: getRateLimitResetTimeMock,
}));

mock.module('../../../lib/prompt/submit-prompt', () => ({
  submitPrompt: submitPromptMock,
}));

mock.module('../../../lib/platform/desktop/app-server', () => ({
  getDesktopAppServerComputerUseMode: getDesktopAppServerComputerUseModeMock,
  submitDesktopAppServerRun: submitDesktopAppServerRunMock,
}));

mock.module('../../../lib/platform/PlatformProvider', () => ({
  usePlatformRuntime: () => platformRuntime,
}));

const getHookConfig = () => {
  const call = usePromptSubmissionMock.mock.calls.at(-1)?.[0] as {
    submitPrompt: (params: { prompt: string; attachment_ids?: string[] }) => Promise<{
      ok: boolean;
      value?: { type: string };
      error?: { kind: string; message: string };
    }>;
    allowUnauthenticatedPrompt?: (_prompt: string) => boolean;
    uploadAttachment: typeof uploadAttachmentMock;
    getRateLimitMessage: typeof getRateLimitMessageMock;
    getRateLimitResetTime: typeof getRateLimitResetTimeMock;
  };

  if (!call) {
    throw new Error('Expected usePromptSubmission to be called');
  }

  return call;
};

describe('useWebPromptSubmission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    platformRuntime = 'browser';
    getDesktopAppServerComputerUseModeMock.mockRejectedValue(new Error('not desktop'));
  });

  it('short-circuits prompt submission when a local command handles the prompt', async () => {
    const order: string[] = [];
    const onLocalCommand = vi.fn(async () => {
      order.push('local-command');
      return true;
    });
    const onSendMessage = vi.fn(() => order.push('send-message'));
    const resetFormState = vi.fn(() => order.push('reset-form'));
    const ensureConversationId = vi.fn(async () => {
      order.push('ensure-conversation');
      return 'local-1';
    });
    useWebPromptSubmission({
      ensureConversationId,
      onLocalCommand,
      onSendMessage,
      resetFormState,
    } as any);
    const hookConfig = getHookConfig();

    const result = await hookConfig.submitPrompt({
      prompt: '/mcp list',
      attachment_ids: ['att-1'],
    });

    expect(onLocalCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: '/mcp list',
        attachmentIds: ['att-1'],
      })
    );
    expect(order).toEqual(['ensure-conversation', 'send-message', 'reset-form', 'local-command']);
    expect(result).toEqual({
      ok: true,
      value: { type: 'streaming_started' },
    });
    expect(submitPromptMock).not.toHaveBeenCalled();
  });

  it('allows signed-out desktop slash commands to reach local command handling', () => {
    platformRuntime = 'desktop';
    useWebPromptSubmission({ onLocalCommand: vi.fn(async () => true) } as any);
    const hookConfig = getHookConfig();

    expect(hookConfig.allowUnauthenticatedPrompt?.('/code /tmp/project')).toBe(true);
    expect(hookConfig.allowUnauthenticatedPrompt?.('hello')).toBe(false);
  });

  it('does not short-circuit normal local coding prompts through demo command handling', async () => {
    const onLocalCommand = vi.fn(async () => true);
    submitPromptMock.mockResolvedValue({
      ok: true,
      value: { type: 'streaming_started' },
    });

    useWebPromptSubmission({
      onLocalCommand,
      ensureConversationId: vi.fn(async () => 'local-1'),
    } as any);
    const hookConfig = getHookConfig();

    await hookConfig.submitPrompt({
      prompt:
        'In the local coding workspace, create a folder named demo, add a file called demo/notes.txt with two short lines, read it back, then edit the file to add a final line that says Edited after readback.',
      attachment_ids: [],
    });

    expect(onLocalCommand).not.toHaveBeenCalled();
    expect(submitPromptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('demo/notes.txt'),
      })
    );
  });

  it('does not short-circuit local screen prompts when local Computer Use is disabled', async () => {
    const onLocalCommand = vi.fn(async () => true);
    submitPromptMock.mockResolvedValue({
      ok: true,
      value: { type: 'streaming_started' },
    });

    useWebPromptSubmission({
      onLocalCommand,
      computerUseEnabled: false,
      computerUseTarget: 'local',
    } as any);
    const hookConfig = getHookConfig();

    await hookConfig.submitPrompt({
      prompt: 'Use local Computer Use to take a screenshot of my screen and report the cursor.',
      attachment_ids: [],
    });

    expect(onLocalCommand).not.toHaveBeenCalled();
    expect(submitPromptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('screenshot'),
      })
    );
  });

  it('does not short-circuit local screen prompts when Computer Use targets the virtual browser', async () => {
    const onLocalCommand = vi.fn(async () => true);
    submitPromptMock.mockResolvedValue({
      ok: true,
      value: { type: 'streaming_started' },
    });

    useWebPromptSubmission({
      onLocalCommand,
      computerUseEnabled: true,
      computerUseTarget: 'virtual',
    } as any);
    const hookConfig = getHookConfig();

    await hookConfig.submitPrompt({
      prompt: 'Use local Computer Use to take a screenshot of my screen and report the cursor.',
      attachment_ids: [],
    });

    expect(onLocalCommand).not.toHaveBeenCalled();
    expect(submitPromptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('screenshot'),
      })
    );
  });

  it('short-circuits local screen prompts only when local Computer Use is selected', async () => {
    const onLocalCommand = vi.fn(async () => true);

    useWebPromptSubmission({
      onLocalCommand,
      computerUseEnabled: true,
      computerUseTarget: 'local',
      ensureConversationId: vi.fn(async () => 'local-1'),
    } as any);
    const hookConfig = getHookConfig();

    await hookConfig.submitPrompt({
      prompt: 'Use local Computer Use to take a screenshot of my screen and report the cursor.',
      attachment_ids: [],
    });

    expect(onLocalCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        computerUseEnabled: true,
        computerUseTarget: 'local',
      })
    );
    expect(submitPromptMock).not.toHaveBeenCalled();
  });

  it('returns normalized errors when local command handling rejects', async () => {
    const cases = [
      { error: new Error('Local command exploded'), message: 'Local command exploded' },
      { error: 'string failure', message: 'string failure' },
      {
        error: { code: 'E_LOCAL', detail: 'bad workspace' },
        message: '{"code":"E_LOCAL","detail":"bad workspace"}',
      },
      {
        error: (() => {
          const circular: Record<string, unknown> = {};
          circular['self'] = circular;
          return circular;
        })(),
        message: 'Failed to execute local command',
      },
    ];

    for (const { error, message } of cases) {
      vi.clearAllMocks();
      const onLocalCommand = vi.fn(async () => {
        throw error;
      });
      useWebPromptSubmission({ onLocalCommand } as any);
      const hookConfig = getHookConfig();

      const result = await hookConfig.submitPrompt({
        prompt: '/mcp local',
        attachment_ids: [],
      });

      expect(result).toEqual({
        ok: false,
        error: {
          kind: 'error',
          message,
        },
      });
      expect(submitPromptMock).not.toHaveBeenCalled();
    }
  });

  it('falls through to remote submission when a local command declines handling', async () => {
    const onLocalCommand = vi.fn(async () => false);
    const onSendMessage = vi.fn();
    const resetFormState = vi.fn();
    submitPromptMock.mockResolvedValue({
      ok: true,
      value: { type: 'streaming_started' },
    });

    useWebPromptSubmission({
      onLocalCommand,
      onSendMessage,
      resetFormState,
    } as any);
    const hookConfig = getHookConfig();

    const result = await hookConfig.submitPrompt({
      prompt: '/mcp remote fallback',
      attachment_ids: ['att-1'],
    });

    expect(onLocalCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: '/mcp remote fallback',
        attachmentIds: ['att-1'],
      })
    );
    expect(onSendMessage).toHaveBeenCalledWith('/mcp remote fallback');
    expect(resetFormState).toHaveBeenCalled();
    expect(submitPromptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: '/mcp remote fallback',
        attachment_ids: ['att-1'],
      })
    );
    expect(result).toEqual({
      ok: true,
      value: { type: 'streaming_started' },
    });
  });

  it('forwards MCP tools and approval callbacks to submitPrompt', async () => {
    const onMcpApproval = vi.fn(async () => undefined);
    const mcpToolItems = [{ serverId: 'server-1', toolName: 'search' }];
    submitPromptMock.mockResolvedValue({
      ok: true,
      value: { type: 'streaming_started' },
    });

    useWebPromptSubmission({ onMcpApproval, mcpToolItems } as any);
    const hookConfig = getHookConfig();
    const result = await hookConfig.submitPrompt({
      prompt: 'research',
      attachment_ids: [],
    });

    expect(result.ok).toBe(true);
    expect(submitPromptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'research',
        mcpToolItems,
        onApproval: expect.any(Function),
      })
    );

    const forwarded = submitPromptMock.mock.calls[0]?.[0] as {
      onApproval: (_taskId: string, _approval: unknown) => void;
    };
    forwarded.onApproval('task-1', { permission: 'search' });
    await Promise.resolve();

    expect(onMcpApproval).toHaveBeenCalledWith('task-1', {
      permission: 'search',
    });
  });

  it('forwards selected research workflow metadata to submitPrompt', async () => {
    const researchWorkflow = {
      workflow: 'investment_dossier',
      requiredCitations: true,
      preferredExports: ['docx', 'pdf'],
      sourcePolicy: 'public_and_attached',
    };
    submitPromptMock.mockResolvedValue({
      ok: true,
      value: { type: 'streaming_started' },
    });

    useWebPromptSubmission({ researchWorkflow } as any);
    const hookConfig = getHookConfig();
    await hookConfig.submitPrompt({
      prompt: 'research',
      attachment_ids: [],
    });

    expect(submitPromptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'research',
        researchWorkflow,
      })
    );
  });

  it('uses the desktop app-server run task adapter in desktop runtime', async () => {
    platformRuntime = 'desktop';
    getDesktopAppServerComputerUseModeMock.mockResolvedValue({ enabled: true });
    submitDesktopAppServerRunMock.mockResolvedValue({
      run: { id: 'run-1', status: 'processing' },
    });
    submitPromptMock.mockResolvedValue({
      ok: true,
      value: { type: 'streaming_started' },
    });

    const mcpToolItems = [
      {
        source: 'mcp' as const,
        serverName: 'workspace',
        toolName: 'write_file',
        title: 'write_file',
        description: 'Write files in the local workspace',
      },
    ];
    useWebPromptSubmission({ mcpToolItems } as any);
    const hookConfig = getHookConfig();
    await hookConfig.submitPrompt({
      prompt: 'desktop hello',
      attachment_ids: ['att-1'],
    });

    const forwarded = submitPromptMock.mock.calls[0]?.[0] as {
      runTask: (payload: {
        prompt: string;
        modelId?: string | null;
        projectId?: number | null;
        attachment_ids?: string[];
        options?: Record<string, unknown>;
      }) => Promise<{
        ok: boolean;
        value?: { task_id: string; status: string };
      }>;
    };

    const result = await forwarded.runTask({
      prompt: 'desktop hello',
      modelId: 'gpt-5',
      projectId: 7,
      attachment_ids: ['att-1'],
      options: {
        quickModeEnabled: true,
        autonomyEnabled: false,
        computerUseEnabled: true,
        useLoggedInServices: true,
        agentCount: 1,
        researchWorkflow: {
          workflow: 'investment_dossier',
          requiredCitations: true,
          preferredExports: ['docx', 'pdf'],
          sourcePolicy: 'public_and_attached',
        },
      },
    });

    expect(submitDesktopAppServerRunMock).toHaveBeenCalledWith({
      prompt: 'desktop hello',
      modelId: 'gpt-5',
      quickMode: true,
      autonomous: false,
      computerUse: true,
      computerUseTarget: 'virtual',
      useLoggedInServices: true,
      agentCount: 1,
      projectId: 7,
      attachmentIds: ['att-1'],
      clientMcpTools: [],
      researchWorkflow: {
        workflow: 'investment_dossier',
        requiredCitations: true,
        preferredExports: ['docx', 'pdf'],
        sourcePolicy: 'public_and_attached',
      },
    });
    expect(result).toEqual({
      ok: true,
      value: { task_id: 'run-1', status: 'processing' },
    });
  });

  it('uses persisted desktop computer-use mode when payload metadata is stale', async () => {
    platformRuntime = 'desktop';
    getDesktopAppServerComputerUseModeMock.mockResolvedValue({ enabled: true });
    submitDesktopAppServerRunMock.mockResolvedValue({
      run: { id: 'run-1', status: 'processing' },
    });
    submitPromptMock.mockResolvedValue({
      ok: true,
      value: { type: 'streaming_started' },
    });

    useWebPromptSubmission({} as any);
    const hookConfig = getHookConfig();
    await hookConfig.submitPrompt({
      prompt: 'desktop computer use',
      attachment_ids: [],
    });

    const forwarded = submitPromptMock.mock.calls[0]?.[0] as {
      runTask: (payload: { prompt: string; options?: Record<string, unknown> }) => Promise<{
        ok: boolean;
        value?: { task_id: string; status: string };
      }>;
    };

    await forwarded.runTask({
      prompt: 'desktop computer use',
      options: {
        quickModeEnabled: false,
        computerUseEnabled: false,
        agentCount: 1,
      },
    });

    expect(submitDesktopAppServerRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        computerUse: true,
        computerUseTarget: 'virtual',
        agentCount: 1,
      })
    );
  });

  it('forwards local computer-use target for desktop runs', async () => {
    platformRuntime = 'desktop';
    getDesktopAppServerComputerUseModeMock.mockResolvedValue({ enabled: true });
    submitDesktopAppServerRunMock.mockResolvedValue({
      run: { id: 'run-1', status: 'processing' },
    });
    submitPromptMock.mockResolvedValue({
      ok: true,
      value: { type: 'streaming_started' },
    });

    useWebPromptSubmission({ computerUseTarget: 'local' } as any);
    const hookConfig = getHookConfig();
    await hookConfig.submitPrompt({
      prompt: 'desktop local computer use',
      attachment_ids: [],
    });

    const forwarded = submitPromptMock.mock.calls[0]?.[0] as {
      runTask: (payload: { prompt: string; options?: Record<string, unknown> }) => Promise<{
        ok: boolean;
        value?: { task_id: string; status: string };
      }>;
    };

    await forwarded.runTask({
      prompt: 'desktop local computer use',
      options: {
        computerUseEnabled: true,
      },
    });

    expect(submitDesktopAppServerRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        computerUse: true,
        computerUseTarget: 'local',
      })
    );
  });

  it('returns network errors when desktop app-server run submission fails', async () => {
    platformRuntime = 'desktop';
    getDesktopAppServerComputerUseModeMock.mockResolvedValue(null);
    submitDesktopAppServerRunMock.mockRejectedValue(new Error('app-server unavailable'));
    submitPromptMock.mockResolvedValue({
      ok: true,
      value: { type: 'streaming_started' },
    });

    useWebPromptSubmission({} as any);
    const hookConfig = getHookConfig();
    await hookConfig.submitPrompt({
      prompt: 'desktop run',
      attachment_ids: [],
    });

    const forwarded = submitPromptMock.mock.calls[0]?.[0] as {
      runTask: (payload: { prompt: string; options?: Record<string, unknown> }) => Promise<{
        ok: boolean;
        error?: { kind: string; message: string };
      }>;
    };

    const result = await forwarded.runTask({
      prompt: 'desktop run',
      options: {
        computerUseEnabled: false,
      },
    });

    expect(submitDesktopAppServerRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        computerUse: false,
        computerUseTarget: null,
        useLoggedInServices: null,
      })
    );
    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'network',
        message: 'app-server unavailable',
      },
    });
  });

  it('passes platform helpers into the shared prompt hook', () => {
    useWebPromptSubmission({} as any);
    const hookConfig = getHookConfig();

    expect(usePromptSubmissionMock).toHaveBeenCalled();
    expect(hookConfig.uploadAttachment).toBe(uploadAttachmentMock);
    expect(hookConfig.getRateLimitMessage).toBe(getRateLimitMessageMock);
    expect(hookConfig.getRateLimitResetTime).toBe(getRateLimitResetTimeMock);
  });
});
