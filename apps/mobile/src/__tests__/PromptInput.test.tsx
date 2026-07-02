import { describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { TextInput } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { PromptInput } from '../components/PromptInput';
import { ThemeProvider } from '../contexts/ThemeContext';

// Mocks
jest.mock('../contexts/SyncContext', () => ({
  useSync: () => ({ isOnline: true }),
  SyncProvider: ({ children }: any) => children,
}));

jest.mock('../streaming/useStreamingStore', () => ({
  useStreamingStore: () => false, // return boolean for isStreaming when queried via selector
}));

jest.mock('../components/Icon', () => ({
  Icon: () => null,
}));

jest.mock('../components/PromptInput.AttachmentsBar', () => ({
  AttachmentsBar: () => null,
}));

jest.mock('../components/PromptInput.ModeBadges', () => ({
  ModeBadges: () => null,
}));

jest.mock('../components/PromptInput.ModelSelector', () => ({
  PromptInputModelSelector: () => null,
}));

jest.mock('../components/PromptInput.MoreOptionsSheet', () => ({
  MoreOptionsSheet: () => null,
}));

jest.mock('expo-linear-gradient', () => ({
  LinearGradient: ({ children }: any) => children,
}));

// Mock the state to isolate rendering
jest.mock('../components/PromptInput.state', () => ({
  usePromptInputState: (props: any) => ({
    message: '',
    setMessage: jest.fn<React.Dispatch<React.SetStateAction<string>>>(),
    attachments: [],
    remainingAttachmentSlots: 5,
    removeAttachment: jest.fn(),
    handleFileUpload: jest.fn(),
    isPreparingMessage: false,
    isListening: false,
    transcriptionHint: null,
    handleSend: props.onSend || jest.fn(),
    handleVoiceDictation: jest.fn(),
    modelOptions: [],
    currentModelLabel: 'GPT-4',
    effectiveModelId: 'gpt-4',
    isModelSelectorLoading: false,
    shouldRenderModelSelector: true,
    isModelMenuOpen: false,
    setIsModelMenuOpen: jest.fn(),
    handleModelSelect: jest.fn(),
    isDisabled: false,
    isMoreOptionsOpen: false,
    setIsMoreOptionsOpen: jest.fn(),
    quickModeEnabled: false,
    handleQuickModeToggle: jest.fn(),
    autonomousModeEnabled: false,
    handleAutonomousModeToggle: jest.fn(),
    computerUseEnabled: false,
    handleComputerUseToggle: jest.fn(),
  }),
}));

describe('PromptInput', () => {
  const queryClient = new QueryClient();

  it('renders input field correctly', async () => {
    const onSend = jest.fn();
    let renderer: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <PromptInput onSend={onSend} />
          </ThemeProvider>
        </QueryClientProvider>
      );
    });

    const input = renderer!.root.findByType(TextInput);
    expect(input).toBeDefined();
  });
});

