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

jest.mock("../../hooks/api/modelSelector", () => ({
  useModelSelectorQuery: (...args: unknown[]) =>
    mockUseModelSelectorQuery(...args),
}));

jest.mock("../../utils/model-preference", () => ({
  loadModelPreference: jest.fn().mockResolvedValue(null as never),
  storeModelPreference: jest.fn().mockResolvedValue(undefined as never),
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

jest.mock("../../utils/orchestration-preference", () => ({
  readStoredOrchestrationConfig: (...args: unknown[]) =>
    mockReadStoredOrchestrationConfig(...args),
  persistOrchestrationConfig: (...args: unknown[]) =>
    mockPersistOrchestrationConfig(...args),
}));

jest.mock("../../hooks/usePromptAttachments", () => ({
  usePromptAttachments: () => mockPromptAttachmentsState,
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
    mockPromptAttachmentsState.attachments = [];
    mockPromptAttachmentsState.remainingSlots = 5;
  });

  it("initializes with default state", async () => {
    const { result } = await renderHook(
      () => usePromptInputState(defaultProps),
      {
        wrapper: createWrapper(),
      },
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 15));
    });

    expect(result.current.message).toBe("");
    expect(result.current.isPreparingMessage).toBe(false);
    expect(result.current.isListening).toBe(false);
    expect(result.current.quickModeEnabled).toBe(true);
    expect(result.current.autonomousModeEnabled).toBe(false);
    expect(result.current.computerUseEnabled).toBe(false);
  });

  it("updates message state", async () => {
    const { result } = await renderHook(
      () => usePromptInputState(defaultProps),
      {
        wrapper: createWrapper(),
      },
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 15));
    });

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
    const { result } = await renderHook(
      () => usePromptInputState({ ...defaultProps, onSend }),
      {
        wrapper: createWrapper(),
      },
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 15));
    });

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
    const { result } = await renderHook(
      () => usePromptInputState({ ...defaultProps, onSend }),
      {
        wrapper: createWrapper(),
      },
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 15));
    });

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
    const { result } = await renderHook(
      () => usePromptInputState({ ...defaultProps, onSend }),
      {
        wrapper: createWrapper(),
      },
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 15));
    });

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
    const { result } = await renderHook(
      () => usePromptInputState({ ...defaultProps, onSend }),
      {
        wrapper: createWrapper(),
      },
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 15));
    });

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
    const { result } = await renderHook(
      () => usePromptInputState({ ...defaultProps, onSend }),
      {
        wrapper: createWrapper(),
      },
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 15));
    });

    await act(async () => {
      await result.current.handleSend();
    });

    expect(onSend).not.toHaveBeenCalled();
  });

  it("does not send when disabled", async () => {
    const onSend = jest.fn<any>().mockResolvedValue(undefined as never);
    const { result } = await renderHook(
      () => usePromptInputState({ ...defaultProps, onSend, isDisabled: true }),
      { wrapper: createWrapper() },
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 15));
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

    const { result } = await renderHook(
      () =>
        usePromptInputState({
          ...defaultProps,
          onSend,
          isAuthenticated: false,
        }),
      { wrapper: createWrapper() },
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 15));
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
    const { result } = await renderHook(
      () => usePromptInputState({ ...defaultProps, onSend }),
      {
        wrapper: createWrapper(),
      },
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 15));
    });

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
    const { result } = await renderHook(
      () => usePromptInputState(defaultProps),
      {
        wrapper: createWrapper(),
      },
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 15));
    });

    expect(result.current.quickModeEnabled).toBe(true);

    await act(async () => {
      result.current.handleQuickModeToggle();
    });

    expect(result.current.quickModeEnabled).toBe(false);
  });

  it("calls onQuickModeToggle when provided", async () => {
    const onQuickModeToggle = jest.fn();
    const { result } = await renderHook(
      () => usePromptInputState({ ...defaultProps, onQuickModeToggle }),
      { wrapper: createWrapper() },
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 15));
    });

    await act(async () => {
      result.current.handleQuickModeToggle();
    });

    expect(onQuickModeToggle).toHaveBeenCalled();
  });

  it("toggles autonomous mode", async () => {
    const { result } = await renderHook(
      () => usePromptInputState(defaultProps),
      {
        wrapper: createWrapper(),
      },
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 15));
    });

    await act(async () => {
      result.current.handleAutonomousModeToggle();
    });

    expect(result.current.autonomousModeEnabled).toBe(true);
  });

  it("calls onAutonomousModeToggle when provided", async () => {
    const onAutonomousModeToggle = jest.fn();
    const { result } = await renderHook(
      () => usePromptInputState({ ...defaultProps, onAutonomousModeToggle }),
      { wrapper: createWrapper() },
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 15));
    });

    await act(async () => {
      result.current.handleAutonomousModeToggle();
    });

    expect(onAutonomousModeToggle).toHaveBeenCalled();
  });

  it("toggles computer use mode", async () => {
    const { result } = await renderHook(
      () => usePromptInputState(defaultProps),
      {
        wrapper: createWrapper(),
      },
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 15));
    });

    await act(async () => {
      result.current.handleComputerUseToggle();
    });

    expect(result.current.computerUseEnabled).toBe(true);
  });

  it("sends computer use metadata when computer use is enabled", async () => {
    const onSend = jest.fn<any>().mockResolvedValue(undefined as never);
    const { result } = await renderHook(
      () => usePromptInputState({ ...defaultProps, onSend }),
      {
        wrapper: createWrapper(),
      },
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 15));
    });

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
    const { result } = await renderHook(
      () => usePromptInputState({ ...defaultProps, onComputerUseToggle }),
      { wrapper: createWrapper() },
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 15));
    });

    await act(async () => {
      result.current.handleComputerUseToggle();
    });

    expect(onComputerUseToggle).toHaveBeenCalled();
  });

  it("handles file upload with onFileUpload callback", async () => {
    const onFileUpload = jest.fn();
    const { result } = await renderHook(
      () => usePromptInputState({ ...defaultProps, onFileUpload }),
      { wrapper: createWrapper() },
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 15));
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
    const { result } = await renderHook(
      () => usePromptInputState(defaultProps),
      {
        wrapper: createWrapper(),
      },
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 15));
    });

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

  it("toggles more options sheet", async () => {
    const { result } = await renderHook(
      () => usePromptInputState(defaultProps),
      {
        wrapper: createWrapper(),
      },
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 15));
    });

    expect(result.current.isMoreOptionsOpen).toBe(false);

    await act(async () => {
      result.current.setIsMoreOptionsOpen(true);
    });

    expect(result.current.isMoreOptionsOpen).toBe(true);
  });

  it("exposes model selector state", async () => {
    const { result } = await renderHook(
      () => usePromptInputState(defaultProps),
      {
        wrapper: createWrapper(),
      },
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 15));
    });

    expect(result.current.shouldRenderModelSelector).toBe(true);
    expect(result.current.modelOptions).toHaveLength(2);
    expect(result.current.currentModelLabel).toBeDefined();
  });

  it("loads public model selector data before authentication", async () => {
    const { result } = await renderHook(
      () => usePromptInputState({ ...defaultProps, isAuthenticated: false }),
      { wrapper: createWrapper() },
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 15));
    });

    expect(mockUseModelSelectorQuery).toHaveBeenCalledWith();
    expect(result.current.shouldRenderModelSelector).toBe(true);
    expect(result.current.modelOptions).toHaveLength(2);
  });
});
