import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Alert } from 'react-native';

import { RemoteNewThreadComposer } from '../../../features/desktop-work/components/RemoteNewThreadComposer';

const mockMutate = jest.fn();
const mockTakePhoto = jest.fn();
const mockPickImages = jest.fn();
const mockPickDocuments = jest.fn();
const mockUploadAttachment = jest.fn(async () => 'attachment-1');
const mockClearAttachments = jest.fn();
const mockStartListening = jest.fn();
const mockAcceptListening = jest.fn();

let mockListening = false;
let mockGitLoading = true;
let mockGitBranch: string | undefined;
let mockAttachments = [{ id: 'local-1', name: 'notes.txt' }];

jest.mock('../../../features/desktop-work/data/desktop-work', () => ({
  useDesktopGitStatusQuery: () => ({
    data: mockGitBranch ? { branch: mockGitBranch } : undefined,
    isLoading: mockGitLoading,
  }),
  useStartDesktopThreadMutation: () => ({ mutate: mockMutate, isPending: false, error: null }),
}));

jest.mock('../../../hooks/usePromptAttachments', () => ({
  usePromptAttachments: () => ({
    attachments: mockAttachments,
    takePhoto: mockTakePhoto,
    pickImages: mockPickImages,
    pickDocuments: mockPickDocuments,
    removeAttachment: jest.fn(),
    clearAttachments: mockClearAttachments,
    uploadAttachment: mockUploadAttachment,
  }),
}));

jest.mock('../../../hooks/usePromptVoice', () => ({
  usePromptVoice: () => ({
    isListening: mockListening,
    startListening: mockStartListening,
    acceptListening: mockAcceptListening,
  }),
}));

jest.mock('../../../features/desktop-work/useRemoteComposerModel', () => ({
  useRemoteComposerModel: () => ({
    options: [],
    modelQuery: { isLoading: false },
    effectiveModelId: 'openai/gpt-5.6-sol',
    selectedEffort: 'high',
    selectModel: jest.fn(),
    selectEffort: jest.fn(),
  }),
}));

jest.mock('../../../features/desktop-work/components/RemoteModelSelector', () => ({
  RemoteModelSelector: () => null,
}));

jest.mock('../../../contexts/ThemeContext', () => ({
  useTheme: () => ({
    theme: {
      colors: {
        border: '#334155',
        cardBackground: '#111827',
        primary: '#3b82f6',
        text: '#f8fafc',
        textMuted: '#94a3b8',
      },
    },
  }),
}));

jest.mock('../../../components/Icon', () => {
  const react = require('react');
  const { Text } = require('react-native');
  return {
    Icon: ({ name }: { name: string }) => react.createElement(Text, null, `icon-${name}`),
  };
});

const project = {
  id: 7,
  name: 'TaskForceAI',
  workspaceRoots: ['/workspace/taskforceai'],
};

const thread = {
  id: 'thread-1',
  sessionId: 'thread-1',
  title: 'Remote task',
  objective: 'Review coverage',
  state: 'active',
  archived: false,
  source: 'mobile',
  taskMode: 'code' as const,
  turns: [],
  activeRunId: null,
  lastError: null,
  createdAt: 1,
  updatedAt: 2,
};

describe('RemoteNewThreadComposer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListening = false;
    mockGitLoading = true;
    mockGitBranch = undefined;
    mockAttachments = [{ id: 'local-1', name: 'notes.txt' }];
    mockUploadAttachment.mockResolvedValue('attachment-1');
  });

  it('chooses destinations and attachment sources, then submits a code task', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const onStarted = jest.fn();
    mockMutate.mockImplementation((_input, options) => {
      options.onSuccess({ thread });
      options.onSettled();
    });
    const view = await render(
      <RemoteNewThreadComposer
        machineName="Studio Mac"
        projects={[project]}
        preset={{ taskMode: 'code', projectId: 7 }}
        onStarted={onStarted}
      />
    );

    expect(view.getByLabelText('Select Remote branch')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('Select Remote destination'));
    const destinationOptions = alert.mock.calls.at(-1)?.[2] ?? [];
    await act(async () => destinationOptions[0]?.onPress?.());
    await act(async () => destinationOptions[1]?.onPress?.());

    await fireEvent.press(view.getByLabelText('Add files to new Remote task'));
    const attachmentOptions = alert.mock.calls.at(-1)?.[2] ?? [];
    attachmentOptions[0]?.onPress?.();
    attachmentOptions[1]?.onPress?.();
    attachmentOptions[2]?.onPress?.();
    expect(mockTakePhoto).toHaveBeenCalled();
    expect(mockPickImages).toHaveBeenCalled();
    expect(mockPickDocuments).toHaveBeenCalled();

    await fireEvent.changeText(view.getByLabelText('New desktop thread prompt'), 'Review coverage');
    await act(async () => fireEvent.press(view.getByLabelText('Start desktop thread')));
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith(thread));
    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        input: 'Review coverage',
        taskMode: 'code',
        projectId: 7,
        attachmentIds: ['attachment-1'],
      }),
      expect.objectContaining({ onSuccess: expect.any(Function), onSettled: expect.any(Function) })
    );
    alert.mockRestore();
  });

  it('dictates into existing input and reports upload failures', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockStartListening.mockImplementationOnce((onTranscript) => onTranscript('dictated text'));
    const view = await render(
      <RemoteNewThreadComposer
        machineName="Studio Mac"
        projects={[project]}
        preset={{ taskMode: 'chat', projectId: null }}
        onStarted={jest.fn()}
      />
    );

    await fireEvent.changeText(view.getByLabelText('New desktop thread prompt'), 'Existing');
    await fireEvent.press(view.getByLabelText('Dictate new Remote task'));
    expect(view.getByLabelText('New desktop thread prompt').props.value).toBe(
      'Existing dictated text'
    );

    mockUploadAttachment.mockRejectedValueOnce('upload failed');
    await act(async () => fireEvent.press(view.getByLabelText('Start desktop thread')));
    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith(
        'Attachment Error',
        'The selected files could not be uploaded.'
      )
    );
    alert.mockRestore();
  });

  it('requires a project for code work and accepts active dictation', async () => {
    mockListening = true;
    mockAttachments = [];
    mockGitLoading = false;
    mockGitBranch = 'codex/test';
    const view = await render(
      <RemoteNewThreadComposer
        machineName="Studio Mac"
        projects={[]}
        preset={{ taskMode: 'code', projectId: null }}
        onStarted={jest.fn()}
      />
    );

    expect(view.getByText('Choose a project before starting Code work.')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('Finish Remote dictation'));
    expect(mockAcceptListening).toHaveBeenCalled();
  });
});
