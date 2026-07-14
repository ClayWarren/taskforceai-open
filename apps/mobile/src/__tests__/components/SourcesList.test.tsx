import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { Linking } from 'react-native';

import { SourcesList } from '../../components/SourcesList';
import type { SourceReference } from '../../types';

jest.mock('../../components/Icon', () => ({
  Icon: () => null,
}));

jest.mock('../../logger', () => ({
  createModuleLogger: jest.fn(() => ({
    error: jest.fn(),
    warn: jest.fn(),
  })),
}));

jest.mock('@taskforceai/design-tokens', () => ({
  spacingTokens: {
    md: 16,
    sm: 8,
  },
}));

describe('SourcesList', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns null for empty sources', async () => {
    const { toJSON } = await render(<SourcesList sources={[]} />);
    expect(toJSON()).toBeNull();
  });

  it('renders sources with count', async () => {
    const sources: SourceReference[] = [
      { url: 'https://example.com', title: 'Example' },
    ];
    const { getByText } = await render(<SourcesList sources={sources} />);
    expect(getByText(/Sources \(1\)/)).toBeTruthy();
  });

  it('renders multiple sources', async () => {
    const sources: SourceReference[] = [
      { url: 'https://example.com', title: 'Example 1' },
      { url: 'https://test.com', title: 'Example 2' },
    ];
    const { getByText } = await render(<SourcesList sources={sources} />);
    expect(getByText(/Sources \(2\)/)).toBeTruthy();
  });

  it('displays title when present', async () => {
    const sources: SourceReference[] = [
      { url: 'https://example.com', title: 'Test Title' },
    ];
    const { getByText } = await render(<SourcesList sources={sources} />);
    expect(getByText('Test Title')).toBeTruthy();
  });

  it('does not display title when not present', async () => {
    const sources: SourceReference[] = [
      { url: 'https://example.com' },
    ];
    const { queryByText } = await render(<SourcesList sources={sources} />);
    expect(queryByText('Test Title')).toBeNull();
  });

  it('displays snippet when present', async () => {
    const sources: SourceReference[] = [
      { url: 'https://example.com', snippet: 'Test snippet' },
    ];
    const { getByText } = await render(<SourcesList sources={sources} />);
    expect(getByText('Test snippet')).toBeTruthy();
  });

  it('does not display snippet when not present', async () => {
    const sources: SourceReference[] = [
      { url: 'https://example.com' },
    ];
    const { queryByText } = await render(<SourcesList sources={sources} />);
    expect(queryByText('Test snippet')).toBeNull();
  });

  it('extracts domain from URL', async () => {
    const sources: SourceReference[] = [
      { url: 'https://www.example.com/path', title: 'Example' },
    ];
    const { getByText } = await render(<SourcesList sources={sources} />);
    expect(getByText('example.com')).toBeTruthy();
  });

  it('drops invalid source URLs', async () => {
    const sources: SourceReference[] = [
      { url: 'invalid-url', title: 'Example' },
    ];
    const { toJSON } = await render(<SourcesList sources={sources} />);
    expect(toJSON()).toBeNull();
  });

  it('opens URL when source is pressed', async () => {
    const mockCanOpenURL = jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(true);
    const mockOpenURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);

    const sources: SourceReference[] = [
      { url: 'https://example.com', title: 'Example' },
    ];
    const { getByText } = await render(<SourcesList sources={sources} />);
    
    await fireEvent.press(getByText('View source'));

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(mockCanOpenURL).toHaveBeenCalledWith('https://example.com');
    expect(mockOpenURL).toHaveBeenCalledWith('https://example.com');

    mockCanOpenURL.mockRestore();
    mockOpenURL.mockRestore();
  });

  it('does not open URL when cannot be opened', async () => {
    const mockCanOpenURL = jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(false);
    const mockOpenURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);

    const sources: SourceReference[] = [
      { url: 'https://example.com', title: 'Example' },
    ];
    const { getByText } = await render(<SourcesList sources={sources} />);
    
    await fireEvent.press(getByText('View source'));

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(mockCanOpenURL).toHaveBeenCalledWith('https://example.com');
    expect(mockOpenURL).not.toHaveBeenCalled();

    mockCanOpenURL.mockRestore();
    mockOpenURL.mockRestore();
  });

  it('handles URL capability lookup failures', async () => {
    const mockCanOpenURL = jest
      .spyOn(Linking, 'canOpenURL')
      .mockRejectedValue(new Error('linking unavailable'));
    const mockOpenURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const { getByText } = await render(
      <SourcesList sources={[{ url: 'https://example.com', title: 'Example' }]} />
    );

    await fireEvent.press(getByText('View source'));
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockOpenURL).not.toHaveBeenCalled();
    mockCanOpenURL.mockRestore();
    mockOpenURL.mockRestore();
  });
});
