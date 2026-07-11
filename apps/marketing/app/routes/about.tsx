import { createFileRoute } from '@tanstack/react-router';

import { pageHead } from '@/lib/seo';

const title = 'About TaskForceAI';
const description =
  'Learn about TaskForceAI, the multi-agent orchestration platform built for developers and organizations.';

export const Route = createFileRoute('/about')({
  component: AboutPage,
  head: () => pageHead({ title, description, path: '/about' }),
});

import { Code, Shield, Target, Users } from 'lucide-react';

import { MarketingLayout } from '@/components/layout/MarketingLayout';

function AboutPage() {
  return (
    <MarketingLayout>
      <div className="mx-auto max-w-4xl py-16">
        {/* Hero Section */}
        <section className="mb-24 text-center">
          <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-6xl lg:text-7xl dark:text-white">
            Building the future of AI orchestration
          </h1>
          <p className="mx-auto mt-8 max-w-3xl text-xl leading-relaxed text-slate-600 dark:text-slate-400">
            TaskForceAI coordinates multiple specialized AI agents to solve complex problems that
            single models struggle with. We&apos;re making multi-agent systems accessible to
            developers and organizations worldwide.
          </p>
        </section>

        {/* Mission Section */}
        <section className="mb-24 rounded-3xl border border-slate-200 bg-white/60 p-8 shadow-2xl md:p-12 dark:border-slate-800 dark:bg-slate-900/40">
          <div className="mb-6 flex items-center gap-4">
            <div className="rounded-xl bg-blue-500/10 p-3">
              <Target className="h-8 w-8 text-blue-400" />
            </div>
            <h2 className="text-3xl font-bold text-slate-900 dark:text-white">Our Mission</h2>
          </div>
          <p className="text-lg leading-relaxed text-slate-700 dark:text-slate-300">
            To democratize advanced AI capabilities through intelligent orchestration. We believe
            the future of AI isn&apos;t in building ever-larger models, but in coordinating
            specialized agents that work together seamlessly.
          </p>
        </section>

        {/* How It Works Section */}
        <section className="mb-24">
          <h2 className="mb-8 text-3xl font-bold text-slate-900 dark:text-white">
            The TaskForceAI Approach
          </h2>
          <div className="space-y-8">
            <p className="text-lg leading-relaxed text-slate-600 dark:text-slate-400">
              Our platform uses a &quot;wisdom of crowds&quot; methodology inspired by research
              showing that multiple independent perspectives produce more reliable results than any
              single model.
            </p>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              <StepCard
                number="1"
                title="Parallel Processing"
                description="Four specialized agents receive identical prompts and reason independently"
              />
              <StepCard
                number="2"
                title="Synthesis"
                description="Results are combined and analyzed to find common patterns and insights"
              />
              <StepCard
                number="3"
                title="Validation"
                description="A validator agent reviews and verifies the synthesized output"
              />
              <StepCard
                number="4"
                title="Delivery"
                description="Final answer is streamed back with full transparency and traceability"
              />
            </div>
          </div>
        </section>

        {/* Principles Section */}
        <section className="mb-24">
          <h2 className="mb-12 text-3xl font-bold text-slate-900 dark:text-white">
            Our Principles
          </h2>
          <div className="grid gap-6">
            <ValueCard
              icon={Code}
              title="Developer-First"
              description="Type-safe SDKs for TypeScript, Python, Go, and Rust. Comprehensive documentation. OpenAPI specifications. Everything developers need to succeed."
            />
            <ValueCard
              icon={Shield}
              title="Transparent"
              description="Open about our capabilities and limitations. Every agent response is traceable. No black boxes, no surprises."
            />
            <ValueCard
              icon={Target}
              title="Reliable"
              description="Built for production with streaming support, automatic retries, comprehensive error handling, and enterprise-grade infrastructure."
            />
            <ValueCard
              icon={Users}
              title="Accessible"
              description="From free tier to enterprise plans. Available on web, desktop, terminal, and mobile. Multi-agent AI for everyone."
            />
          </div>
        </section>

        {/* Contact Section */}
        <section className="rounded-3xl border border-slate-200 bg-white/70 p-12 text-center dark:border-slate-800 dark:bg-slate-900/60">
          <h2 className="mb-4 text-2xl font-bold text-slate-900 dark:text-white">
            Built by developers, for developers
          </h2>
          <p className="mb-8 text-slate-600 dark:text-slate-400">
            Questions, feedback, or partnership inquiries? We&apos;d love to hear from you.
          </p>
          <a
            href="mailto:hello@taskforceai.chat"
            className="text-xl font-semibold text-blue-400 underline decoration-blue-500/30 underline-offset-8 transition-colors hover:text-blue-300 hover:decoration-blue-400"
          >
            hello@taskforceai.chat
          </a>
        </section>

        {/* CTA Section */}
        <section className="mt-24 text-center">
          <h2 className="mb-8 text-3xl font-bold text-slate-900 dark:text-white">
            Start building with TaskForceAI
          </h2>
          <div className="flex items-center justify-center gap-6">
            <a
              href="https://taskforceai.chat/login"
              className="rounded-full bg-blue-600 px-8 py-3 text-sm font-bold text-white shadow-lg shadow-blue-500/25 transition-all hover:bg-blue-500"
            >
              Get Started
            </a>
            <a
              href="https://docs.taskforceai.chat/docs"
              className="text-sm font-semibold text-slate-600 transition-colors hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            >
              View documentation →
            </a>
          </div>
        </section>
      </div>
    </MarketingLayout>
  );
}

function StepCard({
  number,
  title: stepTitle,
  description: stepDescription,
}: {
  number: string;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white/60 p-6 transition-colors hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900/40 dark:hover:border-slate-700">
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-blue-500 text-sm font-bold text-white">
        {number}
      </div>
      <h3 className="mb-2 text-lg font-bold text-slate-900 dark:text-white">{stepTitle}</h3>
      <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-400">
        {stepDescription}
      </p>
    </div>
  );
}

function ValueCard({
  icon: Icon,
  title: valueTitle,
  description: valueDescription,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col gap-6 rounded-2xl border border-slate-200 bg-white/60 p-6 transition-colors hover:border-slate-300 sm:flex-row dark:border-slate-800 dark:bg-slate-900/40 dark:hover:border-slate-700">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-blue-400 dark:bg-slate-800">
        <Icon className="h-6 w-6" />
      </div>
      <div>
        <h3 className="mb-2 text-xl font-bold text-slate-900 dark:text-white">{valueTitle}</h3>
        <p className="leading-relaxed text-slate-600 dark:text-slate-400">{valueDescription}</p>
      </div>
    </div>
  );
}
