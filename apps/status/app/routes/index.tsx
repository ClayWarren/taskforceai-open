import { createFileRoute } from '@tanstack/react-router';

import { StatusPage } from '../components/status/StatusPage';

/**
 * Public status page route (/)
 * Shows system health for all TaskForceAI services
 * No authentication required
 */
export const Route = createFileRoute('/')({
  component: StatusPage,
});
