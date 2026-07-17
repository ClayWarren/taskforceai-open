import { createFileRoute } from '@tanstack/react-router';

import { pageHead } from '@/lib/seo';

const title = 'TaskForceAI Enterprise';
const description =
  'Enterprise TaskForceAI onboarding for managed SAML, security review, governance planning, and support.';

export const Route = createFileRoute('/enterprise/')({
  component: EnterprisePage,
  head: () => pageHead({ title, description, path: '/enterprise' }),
});

import { Check, Shield, Zap, Lock, Users, BarChart3 } from 'lucide-react';

import { MarketingLayout } from '@/components/layout/MarketingLayout';

const enterpriseFeatures = [
  {
    title: 'Managed SAML Onboarding',
    description:
      'Coordinate verified-domain and identity-provider setup directly with our engineering team before your pilot.',
    icon: <Lock className="h-6 w-6 text-blue-400" />,
  },
  {
    title: 'Provisioning Planning',
    description:
      'Review user lifecycle, directory provisioning, and access requirements with us before rollout.',
    icon: <Users className="h-6 w-6 text-blue-400" />,
  },
  {
    title: 'Data-Handling Review',
    description:
      'Document provider routing, retention, and privacy requirements for your intended deployment.',
    icon: <Shield className="h-6 w-6 text-blue-400" />,
  },
  {
    title: 'Workspace Boundaries',
    description:
      'Review organization membership, workspace separation, and access boundaries with the implementation team.',
    icon: <Zap className="h-6 w-6 text-blue-400" />,
  },
  {
    title: 'Security Review Materials',
    description:
      'Request the architecture, data-flow, and available compliance materials needed for your review.',
    icon: <BarChart3 className="h-6 w-6 text-blue-400" />,
  },
  {
    title: 'Dedicated Support',
    description:
      'Priority access to our engineering team and a dedicated account manager for custom tool development.',
    icon: <Check className="h-6 w-6 text-blue-400" />,
  },
];

function EnterprisePage() {
  return (
    <MarketingLayout>
      <div className="flex flex-col gap-24 py-16">
        {/* Hero Section */}
        <section className="text-center">
          <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 sm:text-6xl lg:text-7xl dark:text-white">
            Orchestration for the Enterprise
          </h1>
          <p className="mx-auto mt-8 max-w-3xl text-xl leading-relaxed text-slate-600 dark:text-slate-400">
            Plan a TaskForceAI pilot with managed SAML onboarding, documented data-handling
            requirements, and direct implementation support.
          </p>
          <div className="mt-10 flex flex-wrap justify-center gap-4">
            <a
              href="mailto:sales@taskforceai.chat"
              className="rounded-full bg-blue-600 px-8 py-3 text-sm font-bold text-white shadow-lg shadow-blue-500/25 transition-all hover:bg-blue-500"
            >
              Contact Sales
            </a>
            <a
              href="https://docs.taskforceai.chat/docs"
              className="text-sm font-semibold text-slate-600 transition-colors hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            >
              View documentation →
            </a>
          </div>
        </section>

        {/* Features Grid */}
        <section className="grid grid-cols-1 gap-12 sm:grid-cols-2 lg:grid-cols-3">
          {enterpriseFeatures.map((feature, idx) => (
            <div key={idx} className="group">
              <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-500/10 text-blue-400 transition-colors group-hover:bg-blue-500/20">
                {feature.icon}
              </div>
              <h3 className="mb-3 text-xl font-bold text-slate-900 dark:text-white">
                {feature.title}
              </h3>
              <p className="leading-relaxed text-slate-600 dark:text-slate-400">
                {feature.description}
              </p>
            </div>
          ))}
        </section>

        {/* Support Section */}
        <section className="mt-24 rounded-3xl border border-slate-200 bg-white/60 p-12 text-center dark:border-slate-800 dark:bg-slate-900/40">
          <h2 className="mb-4 text-3xl font-bold text-slate-900 dark:text-white">
            Need something else?
          </h2>
          <p className="mx-auto mb-8 max-w-2xl text-lg text-slate-600 dark:text-slate-400">
            For general questions, billing inquiries, or technical support, our team is always
            available to help.
          </p>
          <div className="flex items-center justify-center gap-6">
            <a
              href="mailto:sales@taskforceai.chat"
              className="text-xl font-semibold text-blue-400 underline decoration-blue-500/30 underline-offset-8 transition-colors hover:text-blue-300 hover:decoration-blue-400"
            >
              sales@taskforceai.chat
            </a>
          </div>
        </section>

        {/* Compliance Section */}
        <section className="rounded-3xl border border-blue-500/20 bg-blue-600/5 p-12 text-center backdrop-blur-sm">
          <h2 className="mb-4 text-3xl font-bold text-slate-900 dark:text-white">
            Ready for technical review.
          </h2>
          <p className="mx-auto mb-12 max-w-2xl text-lg text-slate-600 dark:text-slate-400">
            Contact us for current architecture, data-flow, privacy, and compliance materials before
            your pilot.
          </p>
          <div className="flex flex-wrap justify-center gap-8 opacity-80">
            <ComplianceBadge label="Managed SAML onboarding" />
            <ComplianceBadge label="Security review available" />
            <ComplianceBadge label="Data-handling review" />
            <ComplianceBadge label="Pilot planning" />
          </div>
        </section>

        {/* CTA */}
        <section className="rounded-3xl border border-slate-200 bg-white/70 p-16 text-center dark:border-slate-800 dark:bg-slate-900/60">
          <h2 className="mb-6 text-3xl font-bold text-slate-900 dark:text-white">
            Start your pilot today.
          </h2>
          <p className="mx-auto mb-10 max-w-xl text-lg text-slate-600 dark:text-slate-400">
            Contact our sales team to discuss custom requirements and volume licensing.
          </p>
          <a
            href="mailto:sales@taskforceai.chat"
            className="rounded-full bg-slate-900 px-10 py-4 text-sm font-bold text-white shadow-xl transition-all hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100"
          >
            Contact Sales
          </a>
        </section>
      </div>
    </MarketingLayout>
  );
}

function ComplianceBadge({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
      <Check className="h-5 w-5 text-blue-400" />
      <span>{label}</span>
    </div>
  );
}
