import { type RunTaskAttachment } from './attachments';
import { createAuthClient } from './client/auth';
import { createAgentsClient } from './client/agents';
import { createBillingClient } from './client/billing';
import { createConversationsClient } from './client/conversations';
import { createGdprClient } from './client/gdpr';
import { createFinancesClient } from './client/finances';
import { createIntegrationsClient } from './client/integrations';
import { createMemoriesClient } from './client/memories';
import { createNotificationsClient } from './client/notifications';
import { createPaymentsClient } from './client/payments';
import { createProjectsClient } from './client/projects';
import { createStorageClient } from './client/storage';
import { createTasksClient } from './client/tasks';
import { ApiClientError, createRequestContext, type RequestContextOptions } from './request';

export interface ApiClientOptions extends RequestContextOptions {
  // Add any client-specific options here if needed
}

export type { RunTaskAttachment };
export { ApiClientError };

/**
 * The ApiClient is composed of multiple domain-specific clients.
 * It provides both a namespaced and a flat API for backwards compatibility.
 */
export type ApiClient = ReturnType<typeof createApiClient>;

export const createApiClient = (options: ApiClientOptions = {}) => {
  const context = createRequestContext(options as RequestContextOptions);

  const auth = createAuthClient(context);
  const agents = createAgentsClient(context);
  const billing = createBillingClient(context);
  const conversations = createConversationsClient(context);
  const tasks = createTasksClient(context);
  const projects = createProjectsClient(context);
  const payments = createPaymentsClient(context);
  const integrations = createIntegrationsClient(context);
  const notifications = createNotificationsClient(context);
  const gdpr = createGdprClient(context);
  const finances = createFinancesClient(context);
  const memories = createMemoriesClient(context);
  const storage = createStorageClient(context);

  return {
    // Namespaced API
    auth,
    agents,
    billing,
    conversations,
    tasks,
    projects,
    payments,
    integrations,
    notifications,
    gdpr,
    finances,
    memories,
    storage,

    // Flat API (backwards compatibility)
    ...auth,
    ...agents,
    ...billing,
    ...conversations,
    ...tasks,
    ...projects,
    ...payments,
    ...integrations,
    ...notifications,
    ...gdpr,
    ...finances,
    ...memories,
    ...storage,
  };
};
