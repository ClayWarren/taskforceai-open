import { type IntegrationStatus, integrationStatusSchema } from '@taskforceai/contracts/contracts';
import { createHelpers, encodePathSegment, type RequestContext } from './helpers';

export const createIntegrationsClient = (context: RequestContext) => {
  const { get, request } = createHelpers(context);

  return {
    getIntegrations: (): Promise<IntegrationStatus[]> =>
      get<IntegrationStatus[]>('/api/v1/integrations', integrationStatusSchema.array()),
    disconnectIntegration: (provider: string) =>
      request(
        `/api/v1/integrations/${encodePathSegment(provider)}`,
        { method: 'DELETE' },
        { parseJson: false }
      ),
  };
};
