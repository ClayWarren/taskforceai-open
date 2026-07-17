import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Alert } from 'react-native';

import { RemoteThreadComposer } from '../../../features/desktop-work/components/RemoteThreadComposer';

const mockSend = jest.fn();
const mockStartListening = jest.fn();
const mockCancelListening = jest.fn();
const mockAcceptListening = jest.fn();
const mockUploadAttachment = jest.fn(async () => 'attachment-1');
const mockClearAttachments = jest.fn();
const mockTakePhoto = jest.fn();
const mockPickImages = jest.fn();
const mockPickDocuments = jest.fn();
const mockRemoveAttachment = jest.fn();

const attachment = {
  id: 'local-file',
  uri: 'file:///photo.jpg',
  name: 'photo.jpg',
  size: 42,
  mimeType: 'image/jpeg',
  kind: 'image',
};

const modelOption = {
  id: 'openai/gpt-5.6-sol',
  label: '5.6 Sol',
  description: 'Deep coding model',
  reasoningEffortLevels: ['low', 'high'],
  defaultReasoningEffort: 'high',
};

let mockAttachments = [attachment];
let mockVoiceListening = false;
let mockModelQueryData: {
  defaultModelId: string | null;
  options: (typeof modelOption)[];
} = {
  defaultModelId: modelOption.id,
  options: [modelOption],
};

jest.mock('../../../features/desktop-work/data/desktop-work', () => ({
  useSendDesktopTurnMutation: () => ({ mutate: mockSend, isPending: false, error: null }),
  useDesktopSkillsQuery: () => ({ data: { skills: [] } }),
  useDesktopWorkspaceFilesQuery: () => ({ data: { files: [] }, isLoading: false }),
}));

jest.mock('../../../hooks/api/modelSelector', () => ({
  useModelSelectorQuery: () => ({
    data: mockModelQueryData,
    isLoading: false,
  }),
}));

jest.mock('../../../hooks/usePromptAttachments', () => ({
  usePromptAttachments: () => ({
    attachments: mockAttachments,
    takePhoto: mockTakePhoto,
    pickImages: mockPickImages,
    pickDocuments: mockPickDocuments,
    removeAttachment: mockRemoveAttachment,
    clearAttachments: mockClearAttachments,
    uploadAttachment: mockUploadAttachment,
  }),
}));

jest.mock('../../../hooks/usePromptVoice', () => ({
  usePromptVoice: () => ({
    isListening: mockVoiceListening,
    startListening: mockStartListening,
    cancelListening: mockCancelListening,
    acceptListening: mockAcceptListening,
  }),
}));

jest.mock('../../../features/desktop-work/components/RemoteModelSelector', () => {
  const react = require('react');
  const { TouchableOpacity } = require('react-native');
  return {
    RemoteModelSelector: ({ onModelChange, onEffortChange }: {
      onModelChange: (modelId: string) => void;
      onEffortChange: (effort: string) => void;
    }) => react.createElement(
      react.Fragment,
      null,
      react.createElement(TouchableOpacity, {
        accessibilityLabel: 'Select Remote model',
        onPress: () => onModelChange('openai/gpt-5.6-sol'),
      }),
      react.createElement(TouchableOpacity, {
        accessibilityLabel: 'Select Remote reasoning effort',
        onPress: () => onEffortChange('low'),
      })
    ),
  };
});

jest.mock('../../../contexts/ThemeContext', () => ({
  useTheme: () => ({
    theme: {
      colors: {
        background: '#0f172a',
        border: '#334155',
        cardBackground: '#111827',
        primary: '#3b82f6',
        text: '#f8fafc',
        textMuted: '#94a3b8',
      },
    },
  }),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: React.PropsWithChildren) => children,
}));

jest.mock('../../../components/Icon', () => {
  const react = require('react');
  const { Text } = require('react-native');
  return {
    Icon: ({ name }: { name: string }) => react.createElement(Text, null, `icon-${name}`),
  };
});

const thread = {
  id: 'thread-1',
  sessionId: 'thread-1',
  title: 'Remote task',
  objective: 'Continue work',
  state: 'active',
  archived: false,
  source: 'desktop',
  taskMode: 'code' as const,
  turns: [],
  activeRunId: null,
  lastError: null,
  createdAt: 1,
  updatedAt: 2,
};

describe('RemoteThreadComposer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAttachments = [attachment];
    mockVoiceListening = false;
    mockModelQueryData = {
      defaultModelId: modelOption.id,
      options: [modelOption],
    };
    mockUploadAttachment.mockResolvedValue('attachment-1');
    mockSend.mockImplementation((_input, options: { onSuccess?: () => void; onSettled?: () => void }) => {
      options.onSuccess?.();
      options.onSettled?.();
    });
  });

  it('uploads mobile files and sends model plus effort to a queued Mac follow-up', async () => {
    const { getByLabelText } = await render(<RemoteThreadComposer thread={thread} running />);

    expect(getByLabelText('Add files to Remote follow up')).toBeTruthy();
    expect(getByLabelText('Dictate Remote follow up')).toBeTruthy();
    expect(getByLabelText('Select Remote model')).toBeTruthy();

    await fireEvent.press(getByLabelText('Select Remote model'));
    await fireEvent.press(getByLabelText('Select Remote reasoning effort'));
    await fireEvent.press(getByLabelText('Queue follow-up'));
    await fireEvent.changeText(getByLabelText('Desktop follow up'), 'Review this photo');
    await act(async () => {
      fireEvent.press(getByLabelText('Send desktop follow up'));
    });

    await waitFor(() =>
      expect(mockSend).toHaveBeenCalledWith(
        {
          threadId: 'thread-1',
          input: 'Review this photo',
          behavior: 'queue',
          modelId: 'openai/gpt-5.6-sol',
          reasoningEffort: 'low',
          attachmentIds: ['attachment-1'],
          planMode: false,
          permissionProfile: 'full_access',
          clientMessageId: expect.stringMatching(/^mobile-/),
        },
        expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) })
      )
    );
    expect(mockClearAttachments).toHaveBeenCalled();
  });

  it('does not upload attachments for steering requests', async () => {
    mockAttachments = [];
    const { getByLabelText } = await render(<RemoteThreadComposer thread={thread} running />);

    await fireEvent.changeText(getByLabelText('Desktop follow up'), 'Change direction');
    await act(async () => {
      fireEvent.press(getByLabelText('Send desktop follow up'));
    });

    await waitFor(() =>
      expect(mockSend).toHaveBeenCalledWith(
        {
          threadId: 'thread-1',
          input: 'Change direction',
          behavior: 'steer',
        },
        expect.objectContaining({ onSuccess: expect.any(Function), onSettled: expect.any(Function) })
      )
    );
    expect(mockUploadAttachment).not.toHaveBeenCalled();
  });

  it('prevents switching to steer while attachments are selected', async () => {
    const { getByLabelText } = await render(<RemoteThreadComposer thread={thread} running />);

    expect(getByLabelText('Steer current turn').props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: true })
    );
    await fireEvent.press(getByLabelText('Steer current turn'));
    await fireEvent.changeText(getByLabelText('Desktop follow up'), 'Use this file');
    await act(async () => {
      fireEvent.press(getByLabelText('Send desktop follow up'));
    });

    await waitFor(() =>
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({ behavior: 'queue', attachmentIds: ['attachment-1'] }),
        expect.any(Object)
      )
    );
    expect(mockUploadAttachment).toHaveBeenCalledTimes(1);
  });

  it('offers camera, photos, files, and native dictation', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { getByLabelText } = await render(<RemoteThreadComposer thread={thread} running={false} />);

    await fireEvent.press(getByLabelText('Add files to Remote follow up'));
    expect(alert).toHaveBeenCalledWith(
      'Add Attachment',
      'Choose a source',
      expect.arrayContaining([
        expect.objectContaining({ text: 'Camera' }),
        expect.objectContaining({ text: 'Photo Library' }),
        expect.objectContaining({ text: 'Browse Files' }),
      ])
    );

    mockStartListening.mockImplementationOnce((onTranscript: (text: string) => void) => {
      onTranscript('dictated text');
    });
    await fireEvent.press(getByLabelText('Dictate Remote follow up'));
    expect(mockStartListening).toHaveBeenCalled();
    alert.mockRestore();
  });

  it('cancels and accepts active Remote dictation', async () => {
    mockVoiceListening = true;
    const { getByLabelText } = await render(
      <RemoteThreadComposer thread={thread} running={false} />
    );

    await fireEvent.press(getByLabelText('Cancel Remote dictation'));
    await fireEvent.press(getByLabelText('Finish Remote dictation'));

    expect(mockCancelListening).toHaveBeenCalledTimes(1);
    expect(mockAcceptListening).toHaveBeenCalledTimes(1);
  });

  it('reports attachment upload failures', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockUploadAttachment.mockRejectedValueOnce(new Error('upload failed'));
    const { getByLabelText } = await render(
      <RemoteThreadComposer thread={thread} running={false} />
    );

    await fireEvent.changeText(getByLabelText('Desktop follow up'), 'Upload this');
    await act(async () => {
      getByLabelText('Send desktop follow up').props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(alert).toHaveBeenCalledWith('Remote Error', 'upload failed');
    });
    expect(mockSend).not.toHaveBeenCalled();
    alert.mockRestore();
  });

  it('ignores effort selection when no Remote model is available', async () => {
    mockAttachments = [];
    mockModelQueryData = { defaultModelId: null, options: [] };
    const { getByLabelText } = await render(
      <RemoteThreadComposer thread={thread} running={false} />
    );

    await fireEvent.press(getByLabelText('Select Remote reasoning effort'));

    expect(mockSend).not.toHaveBeenCalled();
  });
});
