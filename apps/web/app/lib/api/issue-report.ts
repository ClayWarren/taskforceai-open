import {
  submitIssueReport,
  type SubmitIssueParams,
} from '@taskforceai/api-client/services/issue-report';
import { getRuntimeEnv } from '@taskforceai/config/app-env';

const APP_VERSION =
  getRuntimeEnv('VITE_APP_VERSION') ?? getRuntimeEnv('VITE_VERCEL_GIT_COMMIT_SHA') ?? 'web';

export const submitWebIssueReport = (params: Omit<SubmitIssueParams, 'appVersion'>) =>
  submitIssueReport({ ...params, appVersion: APP_VERSION });
