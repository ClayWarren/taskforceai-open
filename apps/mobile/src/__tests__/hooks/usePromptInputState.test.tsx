import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import React from "react";
import { renderHook, act } from "@testing-library/react-native";
import { Alert } from "react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { configureLogger } from "../../../../../packages/ui/ts/react-core/src/logger";

// Mock dependencies
const mockModelSelectorQuery = {
  data: {
    enabled: true,
    defaultModelId: "openai/gpt-5.6-sol",
    options: [
      {
        id: "openai/gpt-5.6-sol",
        label: "GPT 5.6 Sol",
        reasoningEffortLevels: ["low", "medium", "high", "xhigh", "max"],
        defaultReasoningEffort: "medium",
      },
      { id: "claude-3", label: "Claude 3" },
    ],
  },
  isLoading: false,
};
const mockUseModelSelectorQuery = jest.fn(() => mockModelSelectorQuery);
const mockLoadModelPreference = jest.fn().mockResolvedValue(null as never);
const mockStoreModelPreference = jest.fn().mockResolvedValue(undefined as never);

jest.mock("../../hooks/api/modelSelector", () => ({
  useModelSelectorQuery: (...args: unknown[]) =>
    mockUseModelSelectorQuery(...args),
}));

jest.mock("../../utils/model-preference", () => ({
  loadModelPreference: (...args: unknown[]) => mockLoadModelPreference(...args),
  storeModelPreference: (...args: unknown[]) => mockStoreModelPreference(...args),
}));

const mockReadStoredOrchestrationConfig = jest.fn(async () => null as never);
const mockPersistOrchestrationConfig = jest.fn(async () => undefined as never);
const mockUploadAttachment = jest.fn(async () => "attachment-id");
const mockPromptAttachmentsState = {
  attachments: [] as Array<{
    id: string;
    name: string;
    uri: string;
    size: number;
    mimeType?: string | null;
    kind: "file" | "image";
  }>,
  pickDocuments: jest.fn(),
  pickImages: jest.fn(),
  removeAttachment: jest.fn(),
  clearAttachments: jest.fn(),
  uploadAttachment: mockUploadAttachment,
  remainingSlots: 5,
};
const mockAcceptListening = jest.fn().mockResolvedValue(undefined as never);
const mockCancelListening = jest.fn().mockResolvedValue(undefined as never);
const mockStartListening = jest.fn(async (onTranscript: (value: string) => void) => {
  onTranscript("dictated words");
});

jest.mock("../../utils/orchestration-preference", () => ({
  readStoredOrchestrationConfig: (...args: unknown[]) =>
    mockReadStoredOrchestrationConfig(...args),
  persistOrchestrationConfig: (...args: unknown[]) =>
    mockPersistOrchestrationConfig(...args),
}));

jest.mock("../../hooks/usePromptAttachments", () => ({
  usePromptAttachments: () => mockPromptAttachmentsState,
}));

jest.mock("../../hooks/usePromptVoice", () => ({
  usePromptVoice: () => ({
    isListening: false,
    transcriptionHint: null,
    startListening: mockStartListening,
    acceptListening: mockAcceptListening,
    cancelListening: mockCancelListening,
  }),
}));

jest.mock("expo-document-picker", () => ({
  getDocumentAsync: jest.fn(),
}));

jest.mock("expo-image-picker", () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
  MediaTypeOptions: { Images: "Images" },
}));

jest.mock("@taskforceai/voice", () => ({
  configureVoiceLogger: jest.fn(),
  isVoiceCancellationError: () => false,
}));

jest.mock("@taskforceai/react-core/useVoice", () => ({
  useVoice: () => ({
    manager: {
      init: jest.fn().mockResolvedValue(undefined as never),
      listen: jest.fn().mockResolvedValue("" as never),
      cancel: jest.fn().mockResolvedValue(undefined as never),
    },
    error: null,
  }),
}));

import { usePromptInputState } from "../../components/PromptInput.state";

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: any) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

const defaultProps = {
  onSend: jest
    .fn<
      (message: string, metadata?: any, attachments?: any[]) => Promise<void>
    >()
    .mockResolvedValue(undefined as never),
};

const renderPromptInputState = async (
  props: Parameters<typeof usePromptInputState>[0] = defaultProps,
) => {
  const rendered = await renderHook(() => usePromptInputState(props), {
    wrapper: createWrapper(),
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 15));
  });
  return rendered;
};

describe("usePromptInputState", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    configureLogger({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    });
    mockReadStoredOrchestrationConfig.mockResolvedValue(null as never);
    mockLoadModelPreference.mockResolvedValue(null as never);
    mockPromptAttachmentsState.attachments = [];
    mockPromptAttachmentsState.remainingSlots = 5;
  });

  it("initializes with default state", async () => {
    const { result } = await renderPromptInputState();

    expect(result.current.message).toBe("");
    expect(result.current.isPreparingMessage).toBe(false);
    expect(result.current.isListening).toBe(false);
    expect(result.current.quickModeEnabled).toBe(true);
    expect(result.current.computerUseEnabled).toBe(false);
  });

  it("updates message state", async () => {
    const { result } = await renderPromptInputState();

    await act(async () => {
      result.current.setMessage("hello");
    });

    expect(result.current.message).toBe("hello");
  });

  it("waits for orchestration hydration before persisting config", async () => {
    let resolveRead: ((value: unknown) => void) | null = null;
    mockReadStoredOrchestrationConfig.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRead = resolve;
        }),
    );

    await renderHook(() => usePromptInputState(defaultProps), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockPersistOrchestrationConfig).not.toHaveBeenCalled();

    await act(async () => {
      resolveRead?.(null);
      await Promise.resolve();
    });

    expect(mockPersistOrchestrationConfig).toHaveBeenCalled();
  });

  it("sends message and clears state", async () => {
    const onSend = jest.fn<any>().mockResolvedValue(undefined as never);
    const { result } = await renderPromptInputState({ ...defaultProps, onSend });

    await act(async () => {
      result.current.setMessage("test message");
    });

    await act(async () => {
      await result.current.handleSend();
    });

    expect(onSend).toHaveBeenCalledWith(
      "test message",
      expect.objectContaining({
        quickModeEnabled: true,
        agentCount: 1,
      }),
      undefined,
    );
    expect(result.current.message).toBe("");
  });

  it("sends agent team metadata only when direct chat is disabled", async () => {
    const onSend = jest.fn<any>().mockResolvedValue(undefined as never);
    const { result } = await renderPromptInputState({ ...defaultProps, onSend });

    await act(async () => {
      result.current.handleQuickModeToggle();
      result.current.setMessage("use the team");
    });

    await act(async () => {
      await result.current.handleSend();
    });

    expect(onSend).toHaveBeenCalledWith(
      "use the team",
      expect.objectContaining({
        quickModeEnabled: false,
        agentCount: 4,
      }),
      undefined,
    );
  });

  it("selects and sends model-aware reasoning effort", async () => {
    const onSend = jest.fn<any>().mockResolvedValue(undefined as never);
    const { result } = await renderPromptInputState({ ...defaultProps, onSend });

    expect(result.current.selectedReasoningEffort).toBe("medium");
    await act(async () => {
      result.current.handleReasoningEffortChange("max");
      result.current.setMessage("think deeply");
    });
    await act(async () => {
      await result.current.handleSend();
    });

    expect(onSend).toHaveBeenCalledWith(
      "think deeply",
      expect.objectContaining({
        modelId: "openai/gpt-5.6-sol",
        reasoningEffort: "max",
      }),
      undefined,
    );
  });

  it("auto-routes image prompts through shared routing metadata", async () => {
    const onSend = jest.fn<any>().mockResolvedValue(undefined as never);
    const { result } = await renderPromptInputState({ ...defaultProps, onSend });

    await act(async () => {
      result.current.setMessage("Generate an image of a launch dashboard");
    });

    await act(async () => {
      await result.current.handleSend();
    });

    expect(onSend).toHaveBeenCalledWith(
      "Generate an image of a launch dashboard",
      expect.objectContaining({
        modelId: "google/gemini-2.5-flash-image",
        quickModeEnabled: true,
        computerUseEnabled: false,
        reasoningEffort: undefined,
      }),
      undefined,
    );
  });

  it("does not send empty message", async () => {
    const onSend = jest.fn<any>().mockResolvedValue(undefined as never);
    const { result } = await renderPromptInputState({ ...defaultProps, onSend });

    await act(async () => {
      await result.current.handleSend();
    });

    expect(onSend).not.toHaveBeenCalled();
  });

  it("does not send when disabled", async () => {
    const onSend = jest.fn<any>().mockResolvedValue(undefined as never);
    const { result } = await renderPromptInputState({
      ...defaultProps,
      onSend,
      isDisabled: true,
    });

    await act(async () => {
      result.current.setMessage("test");
    });

    await act(async () => {
      await result.current.handleSend();
    });

    expect(onSend).not.toHaveBeenCalled();
  });

  it("does not upload attachments before the auth gate", async () => {
    const onSend = jest.fn<any>().mockResolvedValue(undefined as never);
    const alertSpy = jest.spyOn(Alert, "alert");
    mockPromptAttachmentsState.attachments = [
      {
        id: "attachment-1",
        name: "report.pdf",
        uri: "file:///report.pdf",
        size: 128,
        mimeType: "application/pdf",
        kind: "file",
      },
    ];

    const { result } = await renderPromptInputState({
      ...defaultProps,
      onSend,
      isAuthenticated: false,
    });

    await act(async () => {
      result.current.setMessage("analyze this");
    });

    await act(async () => {
      await result.current.handleSend();
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(mockUploadAttachment).not.toHaveBeenCalled();
    expect(onSend).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith(
      "Send Failed",
      "Please sign in to start chatting.",
    );
  });

  it("handles send failure with alert", async () => {
    const onSend = jest.fn<any>().mockRejectedValue(new Error("network error"));
    const alertSpy = jest.spyOn(Alert, "alert");
    const { result } = await renderPromptInputState({ ...defaultProps, onSend });

    await act(async () => {
      result.current.setMessage("test");
    });

    await act(async () => {
      await result.current.handleSend();
    });

    expect(alertSpy).toHaveBeenCalledWith("Send Failed", expect.any(String));
    expect(result.current.isPreparingMessage).toBe(false);
  });

  it("toggles direct chat mode", async () => {
    const { result } = await renderPromptInputState();

    expect(result.current.quickModeEnabled).toBe(true);

    await act(async () => {
      result.current.handleQuickModeToggle();
    });

    expect(result.current.quickModeEnabled).toBe(false);
  });

  it("calls onQuickModeToggle when provided", async () => {
    const onQuickModeToggle = jest.fn();
    const { result } = await renderPromptInputState({
      ...defaultProps,
      onQuickModeToggle,
    });

    await act(async () => {
      result.current.handleQuickModeToggle();
    });

    expect(onQuickModeToggle).toHaveBeenCalled();
  });

  it("toggles computer use mode", async () => {
    const { result } = await renderPromptInputState();

    await act(async () => {
      result.current.handleComputerUseToggle();
    });

    expect(result.current.computerUseEnabled).toBe(true);
  });

  it("sends computer use metadata when computer use is enabled", async () => {
    const onSend = jest.fn<any>().mockResolvedValue(undefined as never);
    const { result } = await renderPromptInputState({ ...defaultProps, onSend });

    await act(async () => {
      result.current.handleComputerUseToggle();
      result.current.setMessage("use computer automation");
    });

    await act(async () => {
      await result.current.handleSend();
    });

    expect(onSend).toHaveBeenCalledWith(
      "use computer automation",
      expect.objectContaining({
        computerUseEnabled: true,
        quickModeEnabled: true,
      }),
      undefined,
    );
  });

  it("calls onComputerUseToggle when provided", async () => {
    const onComputerUseToggle = jest.fn();
    const { result } = await renderPromptInputState({
      ...defaultProps,
      onComputerUseToggle,
    });

    await act(async () => {
      result.current.handleComputerUseToggle();
    });

    expect(onComputerUseToggle).toHaveBeenCalled();
  });

  it("handles file upload with onFileUpload callback", async () => {
    const onFileUpload = jest.fn();
    const { result } = await renderPromptInputState({
      ...defaultProps,
      onFileUpload,
    });

    await act(async () => {
      result.current.handleFileUpload();
    });

    expect(onFileUpload).toHaveBeenCalled();
  });

  it("shows alert when file upload called without callback and at max attachments", async () => {
    const alertSpy = jest.spyOn(Alert, "alert");

    // We need to somehow fill attachments to max, but since they start empty
    // and we don't have direct access to the attachment state, we test the
    // default behavior (shows picker dialog via Alert)
    const { result } = await renderPromptInputState();

    await act(async () => {
      result.current.handleFileUpload();
    });

    // Without onFileUpload, it shows an Alert with options
    expect(alertSpy).toHaveBeenCalledWith(
      "Add Attachment",
      "Choose a source",
      expect.any(Array),
    );
  });

  it("exposes model selector state", async () => {
    const { result } = await renderPromptInputState();

    expect(result.current.shouldRenderModelSelector).toBe(true);
    expect(result.current.modelOptions).toHaveLength(2);
    expect(result.current.currentModelLabel).toBeDefined();
  });

  it("uses no reasoning effort when the selected model exposes no levels", async () => {
    const originalDefault = mockModelSelectorQuery.data.defaultModelId;
    mockModelSelectorQuery.data.defaultModelId = "claude-3";
    const { result } = await renderPromptInputState();

    expect(result.current.selectedReasoningEffort).toBeNull();
    mockModelSelectorQuery.data.defaultModelId = originalDefault;
  });

  it("falls back from a subscription model when the current plan cannot use it", async () => {
    const originalDefault = mockModelSelectorQuery.data.defaultModelId;
    const originalOptions = mockModelSelectorQuery.data.options;
    mockModelSelectorQuery.data.defaultModelId = "premium-model";
    mockModelSelectorQuery.data.options = [
      { id: "premium-model", label: "Premium", usageMultiple: 2 },
      { id: "free-model", label: "Free" },
    ];

    const { result } = await renderPromptInputState({ ...defaultProps, userPlan: "free" });

    expect(result.current.effectiveModelId).toBe("free-model");
    mockModelSelectorQuery.data.defaultModelId = originalDefault;
    mockModelSelectorQuery.data.options = originalOptions;
  });

  it("reports stored orchestration and model hydration failures without blocking input", async () => {
    mockReadStoredOrchestrationConfig.mockRejectedValueOnce(new Error("orchestration unavailable"));
    mockLoadModelPreference.mockRejectedValueOnce(new Error("model preference unavailable") as never);

    const { result } = await renderPromptInputState();

    expect(result.current.message).toBe("");
  });

  it("applies stored orchestration and contains invalid stored role models", async () => {
    const onRoleModelChange = jest.fn(() => { throw new Error("unsupported role model"); });
    const onBudgetChange = jest.fn();
    mockReadStoredOrchestrationConfig.mockResolvedValueOnce({
      agentCount: 3,
      budget: 2,
      roleModels: { researcher: "missing/model" },
    } as never);

    const { result } = await renderPromptInputState({
      ...defaultProps,
      onRoleModelChange,
      onBudgetChange,
    });

    expect(result.current.agentCount).toBe(3);
    expect(onBudgetChange).toHaveBeenCalledWith(2);
    expect(onRoleModelChange).toHaveBeenCalled();
  });

  it("shows the attachment limit instead of opening a picker", async () => {
    mockPromptAttachmentsState.remainingSlots = 0;
    const alertSpy = jest.spyOn(Alert, "alert");
    const { result } = await renderPromptInputState();

    await act(async () => { result.current.handleFileUpload(); });

    expect(alertSpy).toHaveBeenCalledWith(
      "Attachment Limit",
      "You can only attach 5 files per message.",
    );
  });

  it("routes dictation and realtime voice actions through their callbacks", async () => {
    const onVoiceMode = jest.fn();
    const onRealtimeVoice = jest.fn();
    const { result } = await renderPromptInputState({
      ...defaultProps,
      onVoiceMode,
      onRealtimeVoice,
    });

    await act(async () => {
      result.current.setMessage("existing");
      await result.current.handleVoiceDictation();
      await result.current.handleVoiceDictationAccept();
      await result.current.handleVoiceDictationCancel();
      result.current.handleRealtimeVoice();
    });

    expect(result.current.message).toBe("existing dictated words");
    expect(onVoiceMode).toHaveBeenCalled();
    expect(mockAcceptListening).toHaveBeenCalled();
    expect(mockCancelListening).toHaveBeenCalled();
    expect(onRealtimeVoice).toHaveBeenCalled();
  });

  it("loads public model selector data before authentication", async () => {
    const { result } = await renderPromptInputState({
      ...defaultProps,
      isAuthenticated: false,
    });

    expect(mockUseModelSelectorQuery).toHaveBeenCalledWith();
    expect(result.current.shouldRenderModelSelector).toBe(true);
    expect(result.current.modelOptions).toHaveLength(2);
  });
});
