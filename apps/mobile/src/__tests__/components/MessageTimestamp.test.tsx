import React from 'react';
import { render } from '@testing-library/react-native';

import { MessageTimestamp } from '../../components/MessageBubble/MessageTimestamp';

jest.mock('../../utils/date', () => ({
  formatMessageTime: () => '10:42 AM',
}));

describe('MessageTimestamp', () => {
  it.each([
    [true, 'text-white/70'],
    [false, 'text-text-muted'],
  ])('renders formatted time with the expected sender style', async (isUser, expectedClass) => {
    const { getByText } = await render(<MessageTimestamp timestamp={0} isUser={isUser} />);

    expect(getByText('10:42 AM').props.className).toContain(expectedClass);
  });
});
