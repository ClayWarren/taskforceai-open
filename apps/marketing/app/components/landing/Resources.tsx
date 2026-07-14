import { ArrowRight, Command, Globe } from 'lucide-react';
import { Link } from '@tanstack/react-router';

import { CTAButton } from './CTAButton';
import type { ResourceConfig } from './types';

export function ResourcesSection({ resources }: { resources: ResourceConfig[] }) {
  return (
    <section id="developers" className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-2">
          <p className="text-sm font-semibold tracking-[0.26em] text-emerald-700 uppercase dark:text-emerald-300">
            Developers
          </p>
          <h2 className="text-3xl font-semibold text-slate-900 md:text-4xl dark:text-white">
            Build with TaskForceAI
          </h2>
          <p className="max-w-2xl text-base text-slate-700 dark:text-slate-300">
            Typed SDKs, streaming REST, and forward-compatible orchestration hooks.
          </p>
        </div>
        <div className="flex shrink-0">
          <CTAButton
            href="https://console.taskforceai.chat"
            variant="primary"
            icon={<ArrowRight className="h-4 w-4" />}
          >
            API Console
          </CTAButton>
        </div>
      </div>
      <div className="grid gap-6 md:grid-cols-3">
        {resources.map((resource) => {
          const Icon = resource.icon ?? Command;
          return (
            <article
              key={resource.slug}
              className="flex h-full flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-900/5 p-6 shadow-lg shadow-emerald-500/10 dark:border-white/10 dark:bg-white/5"
            >
              <div className="flex items-center gap-3 text-sm text-slate-800 dark:text-slate-200">
                <Icon className="h-5 w-5 text-emerald-700 dark:text-emerald-300" />
                <span className="font-medium tracking-wide text-emerald-800 uppercase dark:text-emerald-200">
                  {resource.category}
                </span>
                <span className="text-slate-600 dark:text-slate-400">•</span>
                <span className="text-slate-700 dark:text-slate-300">{resource.stack}</span>
              </div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                {resource.title}
              </h3>
              <p className="text-sm text-slate-800 dark:text-slate-200">{resource.description}</p>
              <div className="mt-auto space-y-2">
                {resource.command && (
                  <code className="inline-flex items-center gap-2 rounded-lg bg-white/80 px-3 py-2 text-xs text-emerald-800 dark:bg-slate-900/80 dark:text-emerald-200">
                    <Command className="h-4 w-4" />
                    <span>{resource.command}</span>
                  </code>
                )}
                {resource.links ? (
                  <div className="grid grid-cols-2 gap-2 pt-2">
                    {resource.links.map((link) => (
                      <Link
                        key={link.href}
                        to={link.href}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 hover:text-emerald-800 dark:text-emerald-300 dark:hover:text-emerald-200"
                      >
                        <Globe className="h-3 w-3" />
                        {link.label}
                      </Link>
                    ))}
                  </div>
                ) : (
                  <Link
                    to={resource.docsHref}
                    className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-700 hover:text-emerald-800 dark:text-emerald-300 dark:hover:text-emerald-200"
                  >
                    View docs
                    <Globe className="h-4 w-4" />
                  </Link>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
