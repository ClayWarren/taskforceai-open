import { withCsrf } from '@taskforceai/api-client/auth/csrf';

export type MessageFeedbackResult = 'updated' | 'not-rateable';

export const submitMessageFeedback = async (
  messageId: string,
  rating: number
): Promise<MessageFeedbackResult> => {
  const requestInit = await withCsrf({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rating }),
  });
  const response = await fetch(
    `/api/v1/messages/${encodeURIComponent(messageId)}/feedback`,
    requestInit
  );

  if (response.ok) {
    return 'updated';
  }

  if (response.status === 403 || response.status === 404) {
    return 'not-rateable';
  }

  throw new Error(`Failed to submit feedback: ${response.statusText}`);
};
