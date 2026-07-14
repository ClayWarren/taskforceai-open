import { getMobileClient } from './client';

export const submitMessageFeedback = async (messageId: string, rating: number): Promise<void> => {
  await getMobileClient().submitMessageFeedback(messageId, rating);
};
