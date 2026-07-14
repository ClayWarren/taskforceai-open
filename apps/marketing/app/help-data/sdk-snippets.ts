export const sdkAdvancedUsageSnippet = `const taskId = await client.submitTask('Complex analysis', {
  silent: true,  // Suppress server-side logs
  mock: false,   // Use real AI
});

const status = await client.getTaskStatus(taskId);
if (status.status === 'completed') {
  const result = await client.getTaskResult(taskId);
  logger.info({ result: result.result }, 'Task completed successfully');
}`;

export const sdkBasicUsageSnippet = `import pino from 'pino';
import { TaskForceAI } from 'taskforceai-sdk';

const logger = pino();

const client = new TaskForceAI({
  apiKey: process.env.TASKFORCEAI_API_KEY,
});

const result = await client.runTask('Explain quantum computing');
logger.info({ result: result.result }, 'Task completed successfully');`;

export const sdkBrowserUsageSnippet = `// Keep the TaskForceAI API key on your server.
// Browser code should call an authenticated route you control.
const response = await fetch('/api/taskforceai', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt }),
});`;

export const sdkErrorHandlingSnippet = `import pino from 'pino';
import { TaskForceAIError } from 'taskforceai-sdk';

const logger = pino();

try {
  const result = await client.runTask('Your prompt');
  // ...
} catch (error) {
  if (error instanceof TaskForceAIError) {
    logger.error({ error }, 'Task execution failed');
  }
}`;
