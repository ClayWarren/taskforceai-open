import { Link } from '@tanstack/react-router';
import { ArrowLeft, CheckCircle2 } from 'lucide-react';

import { BenchmarkTable } from '@/components/landing/BenchmarkTable';
import { MarketingLayout } from '@/components/layout/MarketingLayout';

const keyResults = [
  "Sentinel is TaskForceAI's model, with benchmark values sourced from Artificial Analysis.",
  'GPT-5.5 (xhigh), Claude Fable 5 (with fallback), Gemini 3.1 Pro Preview, and Grok 4.5 (high) remain included for comparison.',
  'Artificial Analysis Index v4.1 uses nine evaluations and removes IFBench from the Index.',
];

interface BenchmarksPageProps {
  legacyBlogPath?: boolean;
}

export function BenchmarksPage({ legacyBlogPath = false }: BenchmarksPageProps) {
  return (
    <MarketingLayout>
      <article className="mx-auto max-w-5xl py-16">
        <header className="mb-12">
          <Link
            to={legacyBlogPath ? '/benchmarks' : '/'}
            className="group mb-8 inline-flex items-center text-sm font-bold text-slate-500 transition-colors hover:text-slate-900 dark:hover:text-white"
          >
            <ArrowLeft className="mr-2 h-4 w-4 transition-transform group-hover:-translate-x-1" />
            {legacyBlogPath ? 'View canonical benchmarks' : 'Back home'}
          </Link>
          <p className="mb-4 text-xs font-bold tracking-[0.3em] text-blue-400 uppercase">
            Benchmarks · Updated July 1, 2026
          </p>
          <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl lg:text-6xl dark:text-white">
            Frontier Model Benchmarks
          </h1>
          <p className="mt-8 max-w-3xl text-xl leading-relaxed text-slate-600 dark:text-slate-400">
            Current Artificial Analysis benchmark comparisons for Sentinel, TaskForceAI&apos;s
            model, and leading frontier models. End-to-end TaskForceAI orchestration evaluations
            will be published separately.
          </p>
        </header>

        <div className="my-16">
          <BenchmarkTable />
        </div>

        <div className="grid gap-4 rounded-3xl border border-slate-200 bg-white/60 p-8 shadow-2xl dark:border-slate-800 dark:bg-slate-900/40">
          {keyResults.map((item) => (
            <div key={item} className="flex items-start gap-4">
              <CheckCircle2 className="mt-1 h-5 w-5 shrink-0 text-emerald-500" aria-hidden="true" />
              <p className="text-lg font-medium text-slate-700 dark:text-slate-300">{item}</p>
            </div>
          ))}
        </div>

        <div className="mt-16 space-y-16">
          <section className="space-y-6">
            <h2 className="text-3xl font-bold text-slate-900 dark:text-white">Methodology</h2>
            <div className="space-y-4 text-lg leading-relaxed text-slate-600 dark:text-slate-400">
              <p>
                These values come from{' '}
                <a
                  href="https://artificialanalysis.ai/leaderboards/models"
                  className="font-semibold text-blue-600 underline-offset-4 hover:underline dark:text-blue-300"
                >
                  Artificial Analysis model leaderboards
                </a>{' '}
                and their{' '}
                <a
                  href="https://artificialanalysis.ai/methodology/intelligence-benchmarking"
                  className="font-semibold text-blue-600 underline-offset-4 hover:underline dark:text-blue-300"
                >
                  Intelligence Index v4.1 methodology
                </a>
                . The index incorporates GDPval-AA v2, Tau3-Banking, Terminal-Bench v2.1, SciCode,
                AA-LCR, AA-Omniscience, Humanity&apos;s Last Exam, GPQA Diamond, and CritPt. IFBench
                is still published by Artificial Analysis, but is no longer part of the v4.1 Index.
              </p>
              <p>
                Sentinel is TaskForceAI&apos;s model. TaskForceAI&apos;s multi-agent orchestration
                layer is evaluated separately and should not be inferred directly from the benchmark
                numbers shown here.
              </p>
            </div>
          </section>

          <section className="space-y-6">
            <h2 className="text-3xl font-bold text-slate-900 dark:text-white">What&apos;s Next?</h2>
            <p className="text-lg leading-relaxed text-slate-600 dark:text-slate-400">
              We are continuing to evaluate TaskForceAI across end-to-end agentic workflows where
              orchestration, model routing, verification, and long-running tool use matter more than
              a single base-model pass.
            </p>
          </section>
        </div>
      </article>
    </MarketingLayout>
  );
}
