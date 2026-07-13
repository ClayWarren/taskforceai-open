import { createFileRoute } from '@tanstack/react-router';

import { pageHead } from '@/lib/seo';

const title = 'TaskForceAI SDK';
const description =
  'Install and use the TaskForceAI SDKs for TypeScript, Python, Go, Rust, and REST API integrations.';

export const Route = createFileRoute('/sdk/')({
  component: SDKPage,
  head: () => pageHead({ title, description, path: '/sdk' }),
});

import { MarketingLayout } from '@/components/layout/MarketingLayout';

const sdkErrorHandlingSnippet = `import pino from 'pino';
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

const sdkBasicUsageSnippet = `import pino from 'pino';
import { TaskForceAI } from 'taskforceai-sdk';

const logger = pino();

const client = new TaskForceAI({
  apiKey: 'your-api-key',
});

const result = await client.runTask('Explain quantum computing');
logger.info({ result: result.result }, 'Task completed successfully');`;

const sdkAdvancedUsageSnippet = `const taskId = await client.submitTask('Complex analysis', {
  silent: true,  // Suppress server-side logs
  mock: false,   // Use real AI
});

const status = await client.getTaskStatus(taskId);
if (status.status === 'completed') {
  const result = await client.getTaskResult(taskId);
  logger.info({ result: result.result }, 'Task completed successfully');
}`;

function SDKPage() {
  return (
    <MarketingLayout>
      <div className="flex flex-col gap-24 py-16">
        {/* Hero Section */}
        <div className="text-center">
          <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 sm:text-6xl lg:text-7xl dark:text-white">
            TaskForceAI SDK
          </h1>
          <p className="mx-auto mt-8 max-w-3xl text-xl leading-relaxed text-slate-600 dark:text-slate-400">
            Official SDK for integrating TaskForceAI&apos;s multi-agent orchestration capabilities
            into your TypeScript and JavaScript applications.
          </p>
          <div className="mt-10 flex flex-wrap justify-center gap-4">
            <a
              href="#installation"
              className="rounded-full bg-blue-600 px-8 py-3 text-sm font-bold text-white shadow-lg shadow-blue-500/25 transition-all hover:bg-blue-500"
            >
              Get Started
            </a>
            <a
              href="#examples"
              className="rounded-full border border-slate-200 bg-slate-900/10 px-8 py-3 text-sm font-bold text-slate-900 transition-all hover:bg-slate-900/10 dark:border-white/10 dark:bg-white/10 dark:text-white dark:hover:bg-white/20"
            >
              View Examples
            </a>
          </div>
        </div>

        {/* Installation Section */}
        <section id="installation">
          <h2 className="mb-12 text-center text-3xl font-bold text-slate-900 dark:text-white">
            Installation
          </h2>
          <div className="mx-auto max-w-4xl rounded-3xl border border-slate-200 bg-white/60 p-8 md:p-12 dark:border-slate-800 dark:bg-slate-900/40">
            <div className="mb-12">
              <h3 className="mb-4 text-xl font-bold text-slate-900 dark:text-white">
                Package Manager
              </h3>
              <div className="rounded-xl border border-slate-200 bg-white p-5 font-mono text-sm text-blue-400 shadow-2xl dark:border-slate-800 dark:bg-slate-950">
                npm install taskforceai-sdk
              </div>
              <p className="mt-4 text-sm text-slate-500">
                Requires Node.js 18+ for native{' '}
                <code className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  fetch
                </code>{' '}
                support.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
              <div className="space-y-4">
                <h4 className="text-sm font-bold tracking-widest text-slate-500 uppercase">
                  Node.js / TypeScript
                </h4>
                <div className="rounded-xl border border-slate-200 bg-white p-4 font-mono text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
                  {`import { TaskForceAI } from 'taskforceai-sdk';\n\nconst client = new TaskForceAI({\n  apiKey: 'your-api-key',\n});`}
                </div>
              </div>

              <div className="space-y-4">
                <h4 className="text-sm font-bold tracking-widest text-slate-500 uppercase">
                  Browser / Web
                </h4>
                <div className="rounded-xl border border-slate-200 bg-white p-4 font-mono text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
                  {`// Using ES modules in browser\nimport { TaskForceAI } from 'https://unpkg.com/taskforceai-sdk@latest/dist/index.js';\n\nconst client = new TaskForceAI({\n  apiKey: 'your-api-key',\n});`}
                </div>
              </div>
            </div>

            <div className="mt-12 border-t border-slate-200 pt-8 dark:border-slate-800">
              <h4 className="mb-4 text-sm font-bold tracking-widest text-slate-500 uppercase">
                Python
              </h4>
              <div className="inline-block rounded-xl border border-slate-200 bg-white p-4 font-mono text-sm text-blue-400 dark:border-slate-800 dark:bg-slate-950">
                python -m pip install taskforceai
              </div>
              <p className="mt-4 text-sm text-slate-600 dark:text-slate-400">
                Official Python client with full async support and type hints.
              </p>
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section className="grid grid-cols-1 gap-8 md:grid-cols-2">
          <FeatureCard
            icon="🚀"
            title="Multi-Agent Orchestration"
            description="Automatic task decomposition, parallel agent execution, and intelligent synthesis for complex problems."
          />
          <FeatureCard
            icon="🛠️"
            title="Production Ready"
            description="Built-in error handling, rate limiting, authentication, and monitoring for production applications."
          />
          <FeatureCard
            icon="⚡"
            title="High Performance"
            description="Optimized for speed with intelligent caching, streaming responses, and efficient resource usage."
          />
          <FeatureCard
            icon="🔧"
            title="Easy Integration"
            description="Simple API design with comprehensive TypeScript support and extensive documentation."
          />
        </section>

        {/* SDK Examples */}
        <section id="examples" className="space-y-12">
          <h2 className="text-center text-3xl font-bold text-slate-900 dark:text-white">
            SDK Examples
          </h2>
          <div className="mx-auto grid max-w-4xl gap-8">
            <ExampleBlock title="Basic Usage" snippet={sdkBasicUsageSnippet} />
            <ExampleBlock title="Advanced Usage" snippet={sdkAdvancedUsageSnippet} />
            <ExampleBlock
              title="Error Handling"
              snippet={sdkErrorHandlingSnippet}
              color="text-red-400"
            />
          </div>
        </section>

        {/* CTA Section */}
        <section className="rounded-3xl bg-gradient-to-br from-blue-600 to-indigo-700 p-12 text-center shadow-2xl md:p-16">
          <h2 className="mb-4 text-3xl font-bold text-white">Ready to Get Started?</h2>
          <p className="mx-auto mb-10 max-w-xl text-lg text-blue-100 opacity-90">
            Start building with TaskForceAI&apos;s multi-agent orchestration SDK today.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <a
              href="https://console.taskforceai.chat"
              className="rounded-full bg-white px-10 py-4 text-sm font-bold text-blue-600 shadow-xl transition-all hover:bg-slate-100"
            >
              Get API Key
            </a>
            <a
              href="https://docs.taskforceai.chat/docs"
              className="rounded-full border border-white/20 bg-blue-950/20 px-10 py-4 text-sm font-bold text-white backdrop-blur-sm transition-all hover:bg-white/10"
            >
              View API Docs
            </a>
          </div>
        </section>
      </div>
    </MarketingLayout>
  );
}

function FeatureCard({
  icon,
  title: featureTitle,
  description: featureDescription,
}: {
  icon: string;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white/60 p-8 transition-all hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900/40 dark:hover:border-slate-700">
      <div className="mb-4 text-3xl">{icon}</div>
      <h3 className="mb-3 text-xl font-bold text-slate-900 dark:text-white">{featureTitle}</h3>
      <p className="leading-relaxed text-slate-600 dark:text-slate-400">{featureDescription}</p>
    </div>
  );
}

function ExampleBlock({
  title: exampleTitle,
  snippet,
  color = 'text-blue-400',
}: {
  title: string;
  snippet: string;
  color?: string;
}) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-bold tracking-widest text-slate-500 uppercase">{exampleTitle}</h3>
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white p-6 font-mono text-xs shadow-2xl md:text-sm dark:border-slate-800 dark:bg-slate-950">
        <pre className={color}>
          <code>{snippet}</code>
        </pre>
      </div>
    </div>
  );
}
