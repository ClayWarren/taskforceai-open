import { createHelpers, type RequestContext } from './helpers';

export const createGdprClient = (context: RequestContext) => {
  const { request, buildJsonHeaders } = createHelpers(context);

  return {
    exportGdprData: () =>
      request<string>('/api/v1/gdpr/export', { method: 'GET' }, { parseJson: false }),
    deleteAccount: (i: { confirmEmail: string }) =>
      request(
        '/api/v1/gdpr/delete-account',
        { method: 'POST', headers: buildJsonHeaders(), body: JSON.stringify(i) },
        { parseJson: false }
      ),
  };
};
