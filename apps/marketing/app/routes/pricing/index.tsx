import { createFileRoute } from '@tanstack/react-router';

import { pageHead } from '@/lib/seo';

const title = 'TaskForceAI Pricing';
const description = 'Compare TaskForceAI plans, model cost tiers, and workspace limits.';

export const Route = createFileRoute('/pricing/')({
  component: PricingPage,
  head: () => pageHead({ title, description, path: '/pricing' }),
});

import { Check } from 'lucide-react';
import { PLAN_TASK_ALLOWANCES } from '@taskforceai/client-core';

import { MarketingLayout } from '@/components/layout/MarketingLayout';

function checkoutLoginHref(plan: 'pro' | 'super'): string {
  const callbackUrl = `/api/v1/checkout?plan=${plan}`;
  return `https://www.taskforceai.chat/login?plan=${plan}&callbackUrl=${encodeURIComponent(callbackUrl)}`;
}

const pricingTiers = [
  {
    name: 'Free',
    price: '$0',
    description: 'Perfect for exploring the platform.',
    requests: PLAN_TASK_ALLOWANCES.free.label,
    concurrency: '1',
    features: ['Same allowance across apps and API', 'Access to $ and $$ models'],
    cta: 'Get Started',
    ctaHref: 'https://taskforceai.chat/login?callbackUrl=/home',
    mostPopular: false,
  },
  {
    name: 'Pro',
    id: 'pro',
    price: '$28',
    description: 'For power users who need more.',
    requests: PLAN_TASK_ALLOWANCES.pro.label,
    concurrency: '2 concurrent tasks',
    features: [
      'Same allowance across apps and API',
      'Unlock $$$ and $$$+ models',
      'Priority support',
      'Early access to new features',
    ],
    cta: 'Subscribe',
    ctaHref: checkoutLoginHref('pro'),
    mostPopular: true,
  },
  {
    name: 'Super',
    price: '$280',
    description: 'For teams that need agency-grade throughput & uptime.',
    requests: PLAN_TASK_ALLOWANCES.super.label,
    concurrency: '4 concurrent tasks',
    features: ['Everything in Pro', 'Early access to new agents/tools'],
    cta: 'Upgrade to Super',
    ctaHref: checkoutLoginHref('super'),
    mostPopular: false,
  },
];

const modelCostTiers = [
  { model: 'Sentinel (TaskForceAI)', multiplier: '$$' },
  { model: 'GPT 5.6 Sol', multiplier: '$$$+' },
  { model: 'GPT 5.6 Terra', multiplier: '$$$' },
  { model: 'GPT 5.6 Luna', multiplier: '$$' },
  { model: 'Gemini 3.1 Pro', multiplier: '$$$' },
  { model: 'Claude Fable 5', multiplier: '$$$+' },
  { model: 'Grok 4.5', multiplier: '$$' },
];

export function PricingPage() {
  return (
    <MarketingLayout>
      <div className="flex flex-col gap-24 py-12">
        {/* Hero Section */}
        <section className="text-center">
          <h1 className="text-4xl font-bold tracking-tight text-slate-900 md:text-5xl lg:text-6xl dark:text-white">
            Simple, transparent pricing
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-xl leading-relaxed text-slate-600 dark:text-slate-400">
            Choose the plan that fits your needs. Start free and scale as you grow.
          </p>
        </section>

        {/* Pricing Cards */}
        <section className="mx-auto grid max-w-7xl grid-cols-1 gap-8 md:grid-cols-3">
          {pricingTiers.map((tier) => (
            <div
              key={tier.name}
              className={`relative flex flex-col rounded-3xl p-8 backdrop-blur-xl transition-all duration-300 ${
                tier.mostPopular
                  ? 'z-10 scale-105 border-2 border-blue-500 bg-blue-600/10 shadow-2xl shadow-blue-500/20'
                  : 'border border-slate-200 bg-white/70 shadow-xl dark:border-slate-800 dark:bg-slate-900/60'
              }`}
            >
              {tier.mostPopular && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2 rounded-full bg-blue-500 px-4 py-1 text-[10px] font-bold tracking-widest text-white uppercase">
                  Most Popular
                </div>
              )}

              <div className="mb-8">
                <h3 className="text-2xl font-bold text-slate-900 dark:text-white">{tier.name}</h3>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                  {tier.description}
                </p>
              </div>

              <div className="mb-8">
                <div className="flex items-baseline gap-1">
                  <span className="text-5xl font-bold text-slate-900 dark:text-white">
                    {tier.price}
                  </span>
                  <span className="text-slate-600 dark:text-slate-400">/month</span>
                </div>
                <div className="mt-6 flex flex-col gap-2 text-sm text-slate-700 dark:text-slate-300">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Usage:</span>
                    <span>{tier.requests}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Concurrency:</span>
                    <span>{tier.concurrency}</span>
                  </div>
                </div>
              </div>

              <a
                href={tier.ctaHref}
                className={`mb-8 block rounded-xl py-3 text-center text-sm font-bold transition-all ${
                  tier.mostPopular
                    ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/25 hover:bg-blue-400'
                    : 'border border-slate-200 bg-slate-900/10 text-slate-900 hover:bg-slate-900/10 dark:border-white/10 dark:bg-white/10 dark:text-white dark:hover:bg-white/20'
                }`}
              >
                {tier.cta}
              </a>

              <ul className="flex flex-1 flex-col gap-4">
                {tier.features.map((feature, idx) => (
                  <li
                    key={idx}
                    className="flex items-start gap-3 text-sm text-slate-700 dark:text-slate-300"
                  >
                    <Check className="h-5 w-5 shrink-0 text-blue-400" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>

        {/* Multipliers */}
        <section className="rounded-3xl border border-slate-200 bg-white/60 p-8 md:p-12 dark:border-slate-800 dark:bg-slate-900/40">
          <div className="max-w-3xl">
            <h2 className="text-3xl font-bold text-slate-900 dark:text-white">Model cost tiers</h2>
            <p className="mt-4 leading-relaxed text-slate-600 dark:text-slate-400">
              Dollar signs show relative usage cost, from $ for low-cost models to $$$+ for very
              high-cost models. High and very-high cost models require Pro or Super. Every plan
              includes credits tied to your concurrency tier.
            </p>
          </div>
          <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {modelCostTiers.map((entry) => (
              <div
                key={entry.model}
                className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-900/5 px-6 py-4 transition-colors hover:border-slate-200 dark:border-white/5 dark:bg-white/5 dark:hover:border-white/10"
              >
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  {entry.model}
                </span>
                <span className="text-base font-bold tracking-wide text-emerald-700 dark:text-emerald-300">
                  {entry.multiplier}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* FAQ Section */}
        <section className="mx-auto max-w-3xl">
          <h2 className="text-center text-3xl font-bold text-slate-900 dark:text-white">
            Frequently asked questions
          </h2>
          <div className="mt-12 grid gap-10">
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                Can I change plans later?
              </h3>
              <p className="mt-2 leading-relaxed text-slate-600 dark:text-slate-400">
                Yes, you can upgrade or downgrade your plan at any time. Changes take effect
                immediately, and we&apos;ll prorate the charges.
              </p>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                What happens if I exceed my monthly limit?
              </h3>
              <p className="mt-2 leading-relaxed text-slate-600 dark:text-slate-400">
                Your requests will be rate-limited once you hit your monthly quota. You can upgrade
                your plan or wait until the next billing cycle.
              </p>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                Do you offer annual billing?
              </h3>
              <p className="mt-2 leading-relaxed text-slate-600 dark:text-slate-400">
                Yes! Contact our sales team for annual billing options with discounted rates.
              </p>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                Need custom volume or features?
              </h3>
              <p className="mt-2 leading-relaxed text-slate-600 dark:text-slate-400">
                For custom enterprise requirements, dedicated infrastructure, or higher volume
                needs, please contact our sales team.
              </p>
            </div>
          </div>
        </section>
      </div>
    </MarketingLayout>
  );
}
