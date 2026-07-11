import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { ArtifactsScreen } from '../../screens/ArtifactsScreen';
import * as FileSystem from '../../utils/file-system';

const mockRefetch = jest.fn(async () => undefined);
const mockUseArtifactsQuery = jest.fn();
const mockDownloadArtifactContent = jest.fn();
const mockCreatePublicLink = jest.fn();
const mockDeleteArtifact = jest.fn();
const mockUseArtifactVersionsQuery = jest.fn();

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn(async () => undefined),
}));

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => undefined),
}));

jest.mock('../../utils/file-system', () => ({
  cacheDirectory: 'file:///mock-cache/',
  documentDirectory: 'file:///mock-documents/',
  deleteAsync: jest.fn(async () => undefined),
  readAsStringAsync: jest.fn(async () => 'Preview body'),
}));

jest.mock('../../contexts/ThemeContext', () => ({
  __esModule: true,
  useTheme: () => ({
    theme: {
      colors: {
        background: '#000',
        cardBackground: '#111',
        text: '#fff',
      },
    },
  }),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: React.PropsWithChildren) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../../components/Icon', () => {
  const react = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    Icon: ({ name }: { name: string }) => react.createElement(Text, null, `icon-${name}`),
  };
});

jest.mock('../../hooks/api/artifacts', () => ({
  useArtifactsQuery: (...args: unknown[]) => mockUseArtifactsQuery(...args),
  useArtifactVersionsQuery: (...args: unknown[]) => mockUseArtifactVersionsQuery(...args),
  downloadMobileArtifactContent: (...args: unknown[]) => mockDownloadArtifactContent(...args),
  createMobileArtifactPublicLink: (...args: unknown[]) => mockCreatePublicLink(...args),
  deleteMobileArtifact: (...args: unknown[]) => mockDeleteArtifact(...args),
  getArtifactFileContentUrl: (version?: { fileId?: string } | null) =>
    version?.fileId ? `https://api.test/files/${version.fileId}` : null,
  getArtifactMetadataDownloadUrl: () => null,
}));

const artifact = {
  id: 'artifact-1',
  ownerUserId: 7,
  type: 'DOCUMENT',
  title: 'Launch brief',
  status: 'READY',
  visibility: 'PRIVATE',
  currentVersionId: 'version-1',
  currentVersion: {
    id: 'version-1',
    artifactId: 'artifact-1',
    version: 1,
    fileId: 'file-1',
    filename: 'launch-brief.pdf',
    bytes: 2048,
    createdAt: '2026-06-14T00:00:00.000Z',
  },
  createdAt: '2026-06-14T00:00:00.000Z',
  updatedAt: '2026-06-14T00:00:00.000Z',
};

describe('ArtifactsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseArtifactsQuery.mockReturnValue({
      data: [artifact],
      error: null,
      isError: false,
      isFetching: false,
      isLoading: false,
      refetch: mockRefetch,
    });
    mockDownloadArtifactContent.mockImplementation(
      async (_url: string, destinationUri: string) => ({ ok: true, value: destinationUri })
    );
    mockCreatePublicLink.mockResolvedValue({
      ok: true,
      value: { token: 'token-1', url: 'https://taskforceai.chat/artifacts/public/token-1', artifact },
    });
    mockDeleteArtifact.mockResolvedValue({ ok: true, value: undefined });
    mockUseArtifactVersionsQuery.mockReturnValue({
      data: [
        {
          id: 'version-1',
          artifactId: 'artifact-1',
          version: 1,
          fileId: 'file-1',
          filename: 'launch-brief.pdf',
          bytes: 2048,
          createdAt: '2026-06-14T00:00:00.000Z',
        },
      ],
      error: null,
      isFetching: false,
    });
  });

  it('streams artifacts through cache and deletes them after sharing', async () => {
    const { getByLabelText, getByText } = await render(<ArtifactsScreen visible={true} onClose={jest.fn()} />);

    expect(getByText('Launch brief')).toBeTruthy();
    await fireEvent.press(getByLabelText('Download artifact Launch brief'));

    await waitFor(() => {
      expect(mockDownloadArtifactContent).toHaveBeenCalledWith(
        'https://api.test/files/file-1',
        'file:///mock-cache/artifact-download-artifact-1-version-1-launch-brief.pdf',
        { expectedBytes: 2048 }
      );
      expect(Sharing.shareAsync).toHaveBeenCalledWith(
        'file:///mock-cache/artifact-download-artifact-1-version-1-launch-brief.pdf'
      );
      expect(FileSystem.deleteAsync).toHaveBeenCalledWith(
        'file:///mock-cache/artifact-download-artifact-1-version-1-launch-brief.pdf',
        { idempotent: true }
      );
    });
  });

  it('opens a detail view with inline text preview metadata', async () => {
    mockUseArtifactsQuery.mockReturnValue({
      data: [
        {
          ...artifact,
          currentVersion: {
            ...artifact.currentVersion,
            mimeType: 'text/plain',
            filename: 'launch-brief.txt',
          },
        },
      ],
      error: null,
      isError: false,
      isFetching: false,
      isLoading: false,
      refetch: mockRefetch,
    });
    const { getByLabelText, getByText } = await render(<ArtifactsScreen visible={true} onClose={jest.fn()} />);

    await fireEvent.press(getByLabelText('View artifact Launch brief'));

    await waitFor(() => {
      expect(mockDownloadArtifactContent).toHaveBeenCalledWith(
        'https://api.test/files/file-1',
        'file:///mock-cache/artifact-preview-artifact-1-version-1-launch-brief.txt',
        { expectedBytes: 2048, maxBytes: 2097152 }
      );
      expect(getByText('Preview body')).toBeTruthy();
      expect(getByText('Filename')).toBeTruthy();
      expect(getByText('launch-brief.txt')).toBeTruthy();
      expect(getByText('Version 1 - Current')).toBeTruthy();
    });
  });

  it('creates and copies a public link', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { getByLabelText } = await render(<ArtifactsScreen visible={true} onClose={jest.fn()} />);

    await fireEvent.press(getByLabelText('Copy public link for Launch brief'));

    await waitFor(() => {
      expect(mockCreatePublicLink).toHaveBeenCalledWith('artifact-1');
      expect(Clipboard.setStringAsync).toHaveBeenCalledWith(
        'https://taskforceai.chat/artifacts/public/token-1'
      );
      expect(mockRefetch).toHaveBeenCalled();
    });
    alertSpy.mockRestore();
  });

  it('deletes an artifact after confirmation', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      const destructive = buttons?.find((button) => button.style === 'destructive');
      destructive?.onPress?.();
    });
    const { getByLabelText } = await render(<ArtifactsScreen visible={true} onClose={jest.fn()} />);

    await fireEvent.press(getByLabelText('Delete artifact Launch brief'));

    await waitFor(() => {
      expect(mockDeleteArtifact).toHaveBeenCalledWith('artifact-1');
      expect(mockRefetch).toHaveBeenCalled();
    });
    alertSpy.mockRestore();
  });
});
