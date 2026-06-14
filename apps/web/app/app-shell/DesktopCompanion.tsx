'use client';

import clsx from 'clsx';
import { useEffect, useState } from 'react';

import type { AppServerPetState } from '../lib/platform/desktop/app-server';

interface DesktopCompanionProps {
  pet?: AppServerPetState | null;
}

const moodClass = (mood: string) => {
  switch (mood) {
    case 'alert':
      return 'from-rose-300 to-fuchsia-400 shadow-rose-400/30';
    case 'celebrate':
      return 'from-emerald-200 to-cyan-300 shadow-emerald-300/30';
    case 'idle':
      return 'from-slate-300 to-indigo-300 shadow-indigo-300/20';
    default:
      return 'from-sky-200 to-indigo-300 shadow-indigo-300/30';
  }
};

export function DesktopCompanion({ pet }: DesktopCompanionProps) {
  const [blink, setBlink] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setBlink((current) => !current);
    }, 2600);
    return () => window.clearInterval(timer);
  }, []);

  if (!pet?.visible) {
    return null;
  }

  return (
    <div
      aria-label={`${pet.name} companion`}
      title={pet.message}
      className={clsx(
        'pointer-events-none fixed bottom-9 left-[6.25rem] z-[180] hidden h-20 w-20 select-none md:block',
        'motion-safe:animate-[desktop-pet-bob_3.4s_ease-in-out_infinite]'
      )}
    >
      <div
        aria-hidden="true"
        className={clsx(
          'absolute inset-x-3 top-1 h-12 rounded-[18px] border border-white/20 bg-gradient-to-b shadow-2xl',
          moodClass(pet.mood)
        )}
      >
        <div className="absolute inset-x-2 top-3 h-7 rounded-[12px] border border-black/20 bg-slate-950/80">
          <span
            className={clsx(
              'absolute left-3 top-2 block rounded-full bg-sky-100 shadow-[0_0_8px_rgba(191,219,254,0.9)] transition-all',
              blink ? 'h-1 w-3 translate-y-1' : 'h-2.5 w-2.5'
            )}
          />
          <span
            className={clsx(
              'absolute right-3 top-2 block rounded-full bg-sky-100 shadow-[0_0_8px_rgba(191,219,254,0.9)] transition-all',
              blink ? 'h-1 w-3 translate-y-1' : 'h-2.5 w-2.5'
            )}
          />
        </div>
      </div>
      <div
        aria-hidden="true"
        className={clsx(
          'absolute left-5 top-[3.05rem] h-7 w-10 rounded-b-[18px] rounded-t-md border border-white/15 bg-gradient-to-b shadow-xl',
          moodClass(pet.mood)
        )}
      >
        <div className="absolute inset-x-3 top-2 h-1 rounded-full bg-white/55" />
      </div>
      <div className="absolute top-[3.4rem] left-3 h-5 w-3 rotate-12 rounded-full bg-indigo-300/80" />
      <div className="absolute top-[3.4rem] right-3 h-5 w-3 -rotate-12 rounded-full bg-indigo-300/80" />
      <div className="absolute bottom-0 left-6 h-3 w-3 rounded-full bg-indigo-300/80" />
      <div className="absolute right-6 bottom-0 h-3 w-3 rounded-full bg-indigo-300/80" />
    </div>
  );
}
