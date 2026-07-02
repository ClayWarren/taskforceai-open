import { pushTokenDeleteSchema, pushTokenRegistrationSchema } from '../contracts';
import { createHelpers, type RequestContext } from './helpers';

export const createNotificationsClient = (context: RequestContext) => {
  const { request, buildJsonHeaders } = createHelpers(context);

  return {
    registerPushToken: (i: unknown) =>
      request(
        '/api/v1/notifications/push-tokens',
        {
          method: 'POST',
          headers: buildJsonHeaders(),
          body: JSON.stringify(pushTokenRegistrationSchema.parse(i)),
        },
        { parseJson: false }
      ),
    unregisterPushToken: (i: unknown) =>
      request(
        '/api/v1/notifications/push-tokens',
        {
          method: 'DELETE',
          headers: buildJsonHeaders(),
          body: JSON.stringify(
            pushTokenDeleteSchema.parse(typeof i === 'string' ? { token: i } : i)
          ),
        },
        { parseJson: false }
      ),
  };
};
