import { CTAButton } from './CTAButton';
import type { SurfaceCardConfig } from './types';

export function SurfacesSection({ surfaces }: { surfaces: SurfaceCardConfig[] }) {
  return (
    <section id="platforms" className="space-y-8">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-2">
          <p className="text-sm font-semibold tracking-[0.26em] text-sky-700 uppercase dark:text-sky-300">
            Platforms
          </p>
          <h2 className="text-3xl font-semibold text-slate-900 md:text-4xl dark:text-white">
            Pick your surface
          </h2>
          <p className="max-w-2xl text-base text-slate-700 dark:text-slate-300">
            Console, desktop, terminal, or mobile — TaskForceAI meets you where you work.
          </p>
        </div>
      </div>
      <div className="grid gap-6 md:grid-cols-3">
        {surfaces.map((surface) => (
          <article
            key={surface.name}
            className="relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-900/5 p-6 shadow-lg shadow-blue-500/10 dark:border-white/10 dark:bg-white/5"
          >
            <div
              className="pointer-events-none absolute inset-0 opacity-70"
              style={{ backgroundImage: `linear-gradient(135deg, ${surface.accent})` }}
            />
            <div className="relative space-y-3">
              <h3 className="text-xl font-semibold text-slate-900 dark:text-white">
                {surface.name}
              </h3>
              <p className="text-sm text-slate-800 dark:text-slate-200">{surface.description}</p>
              <div className="flex flex-wrap gap-3">
                <CTAButton
                  href={surface.primaryCta.href}
                  variant={surface.primaryCta.variant ?? 'primary'}
                  external={Boolean(surface.primaryCta.external)}
                >
                  {surface.primaryCta.label}
                </CTAButton>
                {surface.secondaryCta ? (
                  <CTAButton
                    href={surface.secondaryCta.href}
                    variant={surface.secondaryCta.variant ?? 'secondary'}
                    external={Boolean(surface.secondaryCta.external)}
                  >
                    {surface.secondaryCta.label}
                  </CTAButton>
                ) : null}
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export default SurfacesSection;
