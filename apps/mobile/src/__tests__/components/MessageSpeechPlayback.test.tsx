import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { MessageSpeechPlayback } from '../../components/MessageBubble/MessageSpeechPlayback';

jest.mock('../../components/Icon', () => require('../helpers/mock-modules').createIconMockModule());

describe('MessageSpeechPlayback', () => {
  it('renders visible playback controls and elapsed time', () => {
    const onPausePress = jest.fn();
    const onStopPress = jest.fn();

    const { getByLabelText, getByText } = render(
      <MessageSpeechPlayback
        elapsedSeconds={65}
        isPaused={false}
        isPreparing={false}
        onPausePress={onPausePress}
        onStopPress={onStopPress}
      />
    );

    fireEvent.press(getByLabelText('Pause speech playback'));
    fireEvent.press(getByLabelText('Stop speech playback'));

    expect(getByText('1:05')).toBeTruthy();
    expect(getByText('1x')).toBeTruthy();
    expect(onPausePress).toHaveBeenCalledTimes(1);
    expect(onStopPress).toHaveBeenCalledTimes(1);
  });

  it('switches the primary playback control while paused', () => {
    const { getByLabelText, getByTestId } = render(
      <MessageSpeechPlayback
        elapsedSeconds={5}
        isPaused={true}
        isPreparing={false}
        onPausePress={jest.fn()}
        onStopPress={jest.fn()}
      />
    );

    expect(getByLabelText('Resume speech playback')).toBeTruthy();
    expect(getByTestId('icon-Play')).toBeTruthy();
  });

  it('shows a loading indicator while speech is preparing', () => {
    const onPausePress = jest.fn();
    const { getByLabelText, getByTestId } = render(
      <MessageSpeechPlayback
        elapsedSeconds={0}
        isPaused={false}
        isPreparing={true}
        onPausePress={onPausePress}
        onStopPress={jest.fn()}
      />
    );

    fireEvent.press(getByLabelText('Preparing speech playback'));

    expect(getByTestId('speech-playback-loading')).toBeTruthy();
    expect(onPausePress).not.toHaveBeenCalled();
  });
});
