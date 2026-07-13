import { createFileRoute } from '@tanstack/react-router';

import { pageHead } from '@/lib/seo';

const title = 'TaskForceAI Enterprise';
const description =
  'Enterprise TaskForceAI features for SSO, directory sync, privacy controls, governance, and support.';

export const Route = createFileRoute('/enterprise/')({
  component: EnterprisePage,
  head: () => pageHead({ title, description, path: '/enterprise' }),
});

import { Check, Shield, Zap, Lock, Users, BarChart3 } from 'lucide-react';

import { MarketingLayout } from '@/components/layout/MarketingLayout';

const enterpriseFeatures = [
  {
    title: 'Enterprise SSO',
    description:
      'Secure authentication via SAML or OIDC. Support for Okta, Azure AD, Google Workspace, and 40+ providers via WorkOS.',
    icon: <Lock className="h-6 w-6 text-blue-400" />,
  },
  {
    title: 'Directory Sync (SCIM)',
    description:
      'Automate user provisioning and deprovisioning. Keep your TaskForceAI workspace in sync with your HR system.',
    icon: <Users className="h-6 w-6 text-blue-400" />,
  },
  {
    title: 'No-Training Guarantee',
    description:
      'Enterprise data is never used to train public models. We support zero-retention endpoints for maximum privacy.',
    icon: <Shield className="h-6 w-6 text-blue-400" />,
  },
  {
    title: 'Multi-Tenant Isolation',
    description:
      'Strict data isolation at the organization level. Your proprietary prompts and outputs stay within your corporate perimeter.',
    icon: <Zap className="h-6 w-6 text-blue-400" />,
  },
  {
    title: 'Audit Logs',
    description:
      'Immutable trail of every user action and model interaction. Exportable to your preferred SIEM or compliance tool.',
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
            Bring TaskForceAI to your entire organization with professional governance, SSO, and
            strict data privacy guarantees.
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
            Our architecture is built from the ground up to satisfy the strictest corporate security
            requirements.
          </p>
          <div className="flex flex-wrap justify-center gap-8 opacity-80">
            <ComplianceBadge label="SOC2 Type II Ready" />
            <ComplianceBadge label="GDPR Compliant" />
            <ComplianceBadge label="SAML 2.0 / OIDC" />
            <ComplianceBadge label="AES-256 Encryption" />
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
