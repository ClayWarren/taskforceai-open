import { createFileRoute } from '@tanstack/react-router';

import { pageHead } from '@/lib/seo';

const title = 'TaskForceAI Pricing';
const description = 'Compare TaskForceAI plans, model usage multipliers, and workspace limits.';

export const Route = createFileRoute('/pricing/')({
  component: PricingPage,
  head: () => pageHead({ title, description, path: '/pricing' }),
});

import { Check } from 'lucide-react';

import { MarketingLayout } from '@/components/layout/MarketingLayout';

const pricingTiers = [
  {
    name: 'Free',
    price: '$0',
    description: 'Perfect for exploring the platform.',
    requests: '1 credit per week',
    rateLimit: '1 credit per week',
    concurrency: '1',
    features: ['~4 credits / month', 'Access to standard models'],
    cta: 'Get Started',
    ctaHref: 'https://taskforceai.chat/login?callbackUrl=/home',
    mostPopular: false,
  },
  {
    name: 'Pro',
    id: 'pro',
    price: '$28',
    description: 'For power users who need more.',
    requests: 'Unlimited messages',
    rateLimit: '2 per hour',
    concurrency: '2 concurrent tasks',
    features: [
      'Unlimited messages',
      'Access to premium models',
      'Priority support',
      'Early access to new features',
    ],
    cta: 'Subscribe',
    ctaHref: 'https://taskforceai.chat/api/v1/checkout?plan=pro',
    mostPopular: true,
  },
  {
    name: 'Super',
    price: '$280',
    description: 'For teams that need agency-grade throughput & uptime.',
    requests: 'Unlimited messages',
    rateLimit: '20 per hour',
    concurrency: '4 concurrent tasks',
    features: ['Everything in Pro', 'Early access to new agents/tools'],
    cta: 'Upgrade to Super',
    ctaHref: 'https://taskforceai.chat/api/v1/checkout?plan=super',
    mostPopular: false,
  },
];

const modelMultipliers = [
  { model: 'Sentinel (TaskForceAI)', multiplier: '1×' },
  { model: 'GPT 5.5', multiplier: '1×' },
  { model: 'Gemini 3.1 Pro', multiplier: '1×' },
  { model: 'Claude Fable 5', multiplier: '2×' },
  { model: 'Grok 4.3', multiplier: '2×' },
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
                    <span className="text-slate-500">Messages:</span>
                    <span>{tier.requests || '50'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Rate limit:</span>
                    <span>{tier.rateLimit || 'N/A'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Concurrency:</span>
                    <span>{tier.concurrency || '1'}</span>
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
            <h2 className="text-3xl font-bold text-slate-900 dark:text-white">
              Model usage multipliers
            </h2>
            <p className="mt-4 leading-relaxed text-slate-600 dark:text-slate-400">
              Every plan includes hourly credits tied to your concurrency tier. Flagship models like{' '}
              <span className="font-semibold text-slate-900 dark:text-white">Sentinel</span> consume
              their standard multiplier, while heavier specialist models use higher multipliers.
            </p>
          </div>
          <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {modelMultipliers.map((entry) => (
              <div
                key={entry.model}
                className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-900/5 px-6 py-4 transition-colors hover:border-slate-200 dark:border-white/5 dark:bg-white/5 dark:hover:border-white/10"
              >
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  {entry.model}
                </span>
                <span className="text-base font-bold text-slate-900 dark:text-white">
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
