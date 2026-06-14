import type { ReactNode } from 'react';

export function Hero({ cta }: { cta: ReactNode }) {
  return (
    <section
      className="mx-auto max-w-4xl space-y-8 py-12 text-center"
      aria-labelledby="hero-heading"
    >
      <div className="space-y-6">
        <h1
          id="hero-heading"
          className="text-4xl font-semibold text-slate-900 md:text-5xl dark:text-white"
          style={{ fontSize: 'clamp(2.5rem, 4vw, 3.75rem)', fontWeight: 700 }}
        >
          Multi-agent orchestration in your workflow
        </h1>
        <p
          className="mx-auto max-w-3xl text-lg text-slate-700 dark:text-slate-300"
          style={{ fontSize: '1.05rem', lineHeight: 1.7 }}
        >
          Four parallel agents research, cross-verify, and synthesize answers with sourcing. Bring
          them into web, desktop, CLI, mobile, or your product via SDKs and REST API.
        </p>
      </div>
      {cta}
    </section>
  );
}

export default Hero;
