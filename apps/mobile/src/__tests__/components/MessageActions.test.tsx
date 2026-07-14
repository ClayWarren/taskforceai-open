import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

import { MessageActions } from '../../components/MessageBubble/MessageActions';

jest.mock('../../components/Icon', () => require('../helpers/mock-modules').createIconMockModule());

describe('MessageActions', () => {
  const defaultProps = {
    isSpeaking: false,
    onSpeakPress: jest.fn(),
    onCopyPress: jest.fn(),
    onSharePress: jest.fn(),
    onRatingPress: jest.fn(),
    rating: 0,
    copied: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders default actions and labels', async () => {
    const { getAllByText, getByLabelText } = await render(<MessageActions {...defaultProps} />);
    expect(getByLabelText('Copy message')).toBeTruthy();
    expect(getByLabelText('Listen to message')).toBeTruthy();
    expect(getByLabelText('Share message')).toBeTruthy();
    expect(getByLabelText('Helpful')).toBeTruthy();
    expect(getByLabelText('Not helpful')).toBeTruthy();
    expect(getAllByText('Copy').length).toBeGreaterThan(0);
  });

  it('switches labels for copied and speaking states', async () => {
    const { getAllByText, getByLabelText, getByText, rerender } = await render(
      <MessageActions {...defaultProps} copied={true} isSpeaking={true} />
    );
    expect(getByLabelText('Message is playing')).toBeTruthy();
    expect(getByText('Listen')).toBeTruthy();
    expect(getAllByText('Copied').length).toBeGreaterThan(0);

    await rerender(<MessageActions {...defaultProps} copied={false} isSpeaking={false} />);
    expect(getByLabelText('Listen to message')).toBeTruthy();
    expect(getByText('Listen')).toBeTruthy();
    expect(getAllByText('Copy').length).toBeGreaterThan(0);
  });

  it('calls action handlers and supports hidden share/rating state', async () => {
    const onCopyPress = jest.fn();
    const onSpeakPress = jest.fn();
    const onSharePress = jest.fn();
    const onRatingPress = jest.fn();
    const { getByLabelText, queryByLabelText, rerender } = await render(
      <MessageActions
        {...defaultProps}
        onCopyPress={onCopyPress}
        onSpeakPress={onSpeakPress}
        onSharePress={onSharePress}
        onRatingPress={onRatingPress}
        rating={undefined}
      />
    );

    await fireEvent.press(getByLabelText('Copy message'));
    await fireEvent.press(getByLabelText('Listen to message'));
    await fireEvent.press(getByLabelText('Share message'));
    await fireEvent.press(getByLabelText('Helpful'));
    await fireEvent.press(getByLabelText('Not helpful'));

    expect(onCopyPress).toHaveBeenCalledTimes(1);
    expect(onSpeakPress).toHaveBeenCalledTimes(1);
    expect(onSharePress).toHaveBeenCalledTimes(1);
    expect(onRatingPress).toHaveBeenCalledWith(1);
    expect(onRatingPress).toHaveBeenCalledWith(-1);
    expect(getByLabelText('Helpful')).toBeTruthy();
    expect(getByLabelText('Not helpful')).toBeTruthy();

    await rerender(<MessageActions {...defaultProps} onSharePress={undefined} />);
    expect(queryByLabelText('Share message')).toBeNull();
  });

  it('hides listen, share, and feedback in private chat', async () => {
    const { getByLabelText, queryByLabelText } = await render(
      <MessageActions {...defaultProps} privateChat={true} />
    );

    expect(getByLabelText('Copy message')).toBeTruthy();
    expect(queryByLabelText('Listen to message')).toBeNull();
    expect(queryByLabelText('Share message')).toBeNull();
    expect(queryByLabelText('Helpful')).toBeNull();
    expect(queryByLabelText('Not helpful')).toBeNull();
  });

  it('does not use the listen action as a stop control while speaking', async () => {
    const onSpeakPress = jest.fn();
    const { getByLabelText } = await render(
      <MessageActions {...defaultProps} isSpeaking={true} onSpeakPress={onSpeakPress} />
    );

    await fireEvent.press(getByLabelText('Message is playing'));

    expect(onSpeakPress).not.toHaveBeenCalled();
  });
});
