import type { HelpArticle } from './types';

export const apiArticles: HelpArticle[] = [
  {
    slug: 'api-authentication',
    categoryId: 'api',
    title: 'API authentication',
    description: 'Authenticate your API requests.',
    lastUpdated: '2026-06-06',
    content: `
# API Authentication

Secure Developer API requests with a TaskForceAI API key.

## Getting an API Key

1. Log in to the [API Console](https://console.taskforceai.chat)
2. Open API Keys
3. Click "Create New Key"
4. Copy and securely store your key

## Using Your API Key

Send your key in the \`x-api-key\` header:

\`\`\`bash
curl https://taskforceai.chat/api/v1/developer/health \\
  -H "x-api-key: YOUR_API_KEY"
\`\`\`

## Base URL

\`\`\`
https://taskforceai.chat/api/v1/developer
\`\`\`

SDKs use this base URL by default. Use the full URL when calling the REST API directly.

## Key Security

- Never expose keys in client-side code
- Use environment variables or a secrets manager
- Create separate keys for development and production
- Rotate and revoke keys from the API Console

## Next Steps

See the [REST API documentation](https://docs.taskforceai.chat/docs/api) for the full endpoint reference.
    `,
  },
  {
    slug: 'making-your-first-request',
    categoryId: 'api',
    title: 'Making your first request',
    description: 'Send your first API request to TaskForceAI.',
    lastUpdated: '2026-06-06',
    content: `
# Making Your First Request

Submit a prompt to the Developer API and poll for the final result.

## Submit a Task

\`\`\`bash
curl https://taskforceai.chat/api/v1/developer/run \\
  -H "x-api-key: YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "prompt": "Analyze the risks in this deployment plan",
    "options": {
      "silent": false,
      "mock": false
    }
  }'
\`\`\`

## Response

\`\`\`json
{
  "taskId": "task_1699123456789_abc123def",
  "status": "processing",
  "message": "Task submitted successfully"
}
\`\`\`

## Check Status

\`\`\`bash
curl https://taskforceai.chat/api/v1/developer/status/task_1699123456789_abc123def \\
  -H "x-api-key: YOUR_API_KEY"
\`\`\`

Completed tasks include a \`result\` field:

\`\`\`json
{
  "taskId": "task_1699123456789_abc123def",
  "status": "completed",
  "result": "Final synthesized response..."
}
\`\`\`

## Advanced Options

Requests can include model selection, task budget, attachments, role model overrides, and bring-your-own Vercel AI Gateway keys. See the [REST API documentation](https://docs.taskforceai.chat/docs/api) for the complete request shape.
    `,
  },
  {
    slug: 'rate-limits-and-quotas',
    categoryId: 'api',
    title: 'Rate limits and quotas',
    description: 'Understand API rate limits and usage quotas.',
    lastUpdated: '2026-06-06',
    content: `
# Rate Limits and Quotas

API limits depend on your developer tier.

## Current Tiers

| Tier | Requests/month | Rate limit |
|------|----------------|------------|
| Starter | 100 | 10/hour |
| Pro | 10,000 | 100/hour |
| Enterprise | 100,000 | 1,000/hour |

Enterprise plans can also support custom limits.

## Monitoring Usage

Use the [API Console](https://console.taskforceai.chat) to:

- View usage for today, this week, and this month
- Track monthly quota and remaining requests
- Monitor per-key usage
- Revoke keys that are no longer needed

## Handling Rate Limits

When a request exceeds its limit, the API returns HTTP \`429\`. Use exponential backoff, avoid unnecessary polling, and cache repeated work where possible.

## Token Costs

AI model usage can be billed separately through Vercel AI Gateway when you bring your own gateway key. The API request quota controls TaskForceAI Developer API access.
    `,
  },
  {
    slug: 'error-handling',
    categoryId: 'api',
    title: 'Error handling',
    description: 'Handle API errors gracefully.',
    lastUpdated: '2026-06-06',
    content: `
# Error Handling

Handle Developer API errors by checking the HTTP status and response body.

## Common Status Codes

| HTTP Status | Meaning |
|-------------|---------|
| \`400\` | Invalid request body |
| \`401\` | Missing or invalid API key |
| \`404\` | Task, thread, or file not found |
| \`429\` | Rate limit or quota exceeded |
| \`500\` | Internal server error |

## Example

\`\`\`typescript
const response = await fetch('https://taskforceai.chat/api/v1/developer/run', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': process.env.TASKFORCEAI_API_KEY ?? '',
  },
  body: JSON.stringify({ prompt: 'Review this plan' }),
});

if (!response.ok) {
  const error = await response.json().catch(() => ({}));
  throw new Error(error.message ?? \`TaskForceAI API error: \${response.status}\`);
}

const task = await response.json();
\`\`\`

## Retry Strategy

Retry transient failures with exponential backoff:

1. Wait 1 second, retry
2. Wait 2 seconds, retry
3. Wait 4 seconds, retry
4. Stop after a small number of attempts

Do not retry validation errors or invalid credentials until the request is fixed.
    `,
  },
];
