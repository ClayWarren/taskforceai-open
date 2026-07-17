import { createFileRoute } from '@tanstack/react-router';

import { pageHead } from '@/lib/seo';

const title = 'TaskForceAI Company';
const description =
  'Meet the principles and platform surfaces behind TaskForceAI multi-agent orchestration.';

export const Route = createFileRoute('/company/')({
  component: CompanyPage,
  head: () => pageHead({ title, description, path: '/company' }),
});

import {
  Layers,
  Code2,
  Globe,
  Eye,
  Zap,
  Shield,
  Monitor,
  Smartphone,
  Terminal,
  Server,
} from 'lucide-react';

import { MarketingLayout } from '@/components/layout/MarketingLayout';

const principles = [
  {
    title: 'Multi-Agent by Design',
    description:
      'Orchestrating multiple AI models to work together, combining their strengths for superior results on complex tasks.',
    icon: <Layers className="h-6 w-6 text-blue-400" />,
  },
  {
    title: 'Developer-First',
    description:
      'APIs, SDKs, and tools that empower builders. We create the infrastructure developers need to build the next generation of AI applications.',
    icon: <Code2 className="h-6 w-6 text-blue-400" />,
  },
  {
    title: 'Universal Access',
    description:
      'Available everywhere you work: web, mobile, desktop, CLI, and API. Your AI assistant should meet you where you are.',
    icon: <Globe className="h-6 w-6 text-blue-400" />,
  },
  {
    title: 'Transparency',
    description:
      'Clear about capabilities and limitations. We believe in honest communication about what AI can and cannot do.',
    icon: <Eye className="h-6 w-6 text-blue-400" />,
  },
  {
    title: 'Speed Without Compromise',
    description:
      'Fast execution without sacrificing quality. Intelligent routing ensures you get the best response in the shortest time.',
    icon: <Zap className="h-6 w-6 text-blue-400" />,
  },
  {
    title: 'Privacy & Control',
    description:
      'Users own their data and interactions. Enterprise-grade security with options for zero-retention and on-premise deployment.',
    icon: <Shield className="h-6 w-6 text-blue-400" />,
  },
];

const platforms = [
  {
    name: 'Web',
    description: 'Full-featured browser experience',
    icon: <Globe className="h-8 w-8 text-blue-400" />,
  },
  {
    name: 'Desktop',
    description: 'Native apps for Mac, Windows, Linux',
    icon: <Monitor className="h-8 w-8 text-blue-400" />,
  },
  {
    name: 'Mobile',
    description: 'iOS and Android applications',
    icon: <Smartphone className="h-8 w-8 text-blue-400" />,
  },
  {
    name: 'CLI',
    description: 'Terminal-native interface',
    icon: <Terminal className="h-8 w-8 text-blue-400" />,
  },
  {
    name: 'API',
    description: 'Build your own integrations',
    icon: <Server className="h-8 w-8 text-blue-400" />,
  },
];

function CompanyPage() {
  return (
    <MarketingLayout>
      <div className="flex flex-col gap-24 py-16">
        {/* Hero Section */}
        <section className="text-center">
          <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 sm:text-6xl lg:text-7xl dark:text-white">
            Multi-Agent AI Orchestration
            <br />
            for Everyone
          </h1>
          <p className="mx-auto mt-8 max-w-2xl text-xl leading-relaxed text-slate-600 dark:text-slate-400">
            TaskForceAI orchestrates multiple AI models to solve complex problems across web,
            mobile, desktop, and API. We&apos;re building the future of AI interaction.
          </p>
        </section>

        {/* Mission Section */}
        <section className="mx-auto max-w-4xl">
          <p className="mb-4 text-xs font-bold tracking-[0.2em] text-blue-400 uppercase">
            Our Mission
          </p>
          <h2 className="mb-6 text-3xl leading-tight font-bold text-slate-900 sm:text-4xl dark:text-white">
            We believe the future of AI is not a single model, but intelligent orchestration of
            specialized agents working together.
          </h2>
          <p className="text-lg leading-relaxed text-slate-600 dark:text-slate-400">
            Different AI models excel at different tasks. Some are better at coding, others at
            reasoning, and others at creative work. TaskForceAI intelligently routes your requests
            to the best model for each task, combining their outputs into cohesive results. We make
            this powerful capability accessible to everyone—from individual developers to enterprise
            teams.
          </p>
        </section>

        {/* Principles Section */}
        <section className="rounded-3xl border border-slate-200 bg-white/60 p-8 md:p-12 dark:border-slate-800 dark:bg-slate-900/40">
          <p className="mb-4 text-center text-xs font-bold tracking-[0.2em] text-slate-500 uppercase">
            Our Principles
          </p>
          <h2 className="mb-12 text-center text-3xl font-bold text-slate-900 dark:text-white">
            What guides us
          </h2>
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {principles.map((principle, idx) => (
              <div
                key={idx}
                className="group rounded-2xl border border-slate-200 bg-slate-900/5 p-6 transition-all hover:bg-slate-900/10 dark:border-white/5 dark:bg-white/5 dark:hover:bg-white/10"
              >
                <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-500/10 text-blue-400">
                  {principle.icon}
                </div>
                <h3 className="mb-2 text-lg font-bold text-slate-900 dark:text-white">
                  {principle.title}
                </h3>
                <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                  {principle.description}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* What We Build Section */}
        <section className="text-center">
          <p className="mb-4 text-xs font-bold tracking-[0.2em] text-slate-500 uppercase">
            What We Build
          </p>
          <h2 className="mb-6 text-3xl font-bold text-slate-900 sm:text-4xl dark:text-white">
            One platform, every interface
          </h2>
          <p className="mx-auto mb-16 max-w-2xl text-lg text-slate-600 dark:text-slate-400">
            Access powerful multi-agent AI wherever you work. Our unified platform delivers
            consistent capabilities across every device and integration.
          </p>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {platforms.map((platform, idx) => (
              <div
                key={idx}
                className="flex flex-col items-center rounded-2xl border border-slate-200 bg-white/70 p-8 transition-all hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900/60 dark:hover:border-slate-700"
              >
                <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-500/10 text-blue-400">
                  {platform.icon}
                </div>
                <h3 className="mb-1 text-base font-bold text-slate-900 dark:text-white">
                  {platform.name}
                </h3>
                <p className="text-xs text-slate-500">{platform.description}</p>
              </div>
            ))}
          </div>
        </section>

        {/* CTA Section */}
        <section className="rounded-3xl border border-slate-200 bg-white/70 p-16 text-center dark:border-slate-800 dark:bg-slate-900/60">
          <h2 className="mb-6 text-3xl font-bold text-slate-900 dark:text-white">
            Ready to experience multi-agent AI?
          </h2>
          <p className="mx-auto mb-10 max-w-xl text-lg text-slate-600 dark:text-slate-400">
            Join thousands of developers and teams using TaskForceAI to build the future.
          </p>
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
