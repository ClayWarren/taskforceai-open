const mockSubmitMessageFeedback = jest.fn().mockResolvedValue(undefined);

jest.mock('../api/client', () => ({
  getMobileClient: () => ({ submitMessageFeedback: mockSubmitMessageFeedback }),
}));

import { submitMessageFeedback } from '../api/messages';

describe('mobile message API', () => {
  it('delegates message ratings to the mobile client', async () => {
    await submitMessageFeedback('message-1', -1);

    expect(mockSubmitMessageFeedback).toHaveBeenCalledWith('message-1', -1);
  });
});
