'use client';

import { ArrowUp, Banknote, Landmark, Plus, WalletCards } from 'lucide-react';
import { useState } from 'react';

import { writeCapturedPromptDraft } from '../../lib/prompt/hydration-draft-capture';
import { ProfileFinanceSection } from '../../lib/profile/ProfileFinanceSection';
import { useRouter } from '../routing';

const financeStarters = [
  {
    icon: Banknote,
    title: 'Subscriptions overview',
    description: 'What subscriptions and recurring charges am I currently paying for?',
  },
  {
    icon: WalletCards,
    title: 'Reduce spending',
    description: 'Where could I reduce spending, subscriptions, or fees this year?',
  },
  {
    icon: Landmark,
    title: 'Loan payoff plan',
    description: 'Create a plan to pay off my loans.',
  },
] as const;

export function FinancePage() {
  const router = useRouter();
  const [prompt, setPrompt] = useState('');
  const [tab, setTab] = useState<'dashboard' | 'accounts'>('dashboard');

  const continueInChat = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextPrompt = prompt.trim();
    if (!nextPrompt) return;
    writeCapturedPromptDraft(nextPrompt);
    void router.navigate({ to: '/' });
  };

  return (
    <section className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-4 pt-24 pb-16 sm:px-8 lg:pt-32">
      <div className="mx-auto w-full max-w-4xl">
        <h1 className="text-3xl font-semibold tracking-tight text-white">Finances</h1>

        <form
          onSubmit={continueInChat}
          className="mt-8 flex items-center gap-3 rounded-[1.75rem] border border-white/10 bg-white/[0.09] px-5 py-3"
        >
          <Plus aria-hidden="true" className="shrink-0 text-slate-300" size={22} />
          <input
            aria-label="Ask about finances"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Ask TaskForceAI"
            className="min-w-0 flex-1 bg-transparent py-1 text-base text-white placeholder:text-slate-400 focus:outline-none"
          />
          <button
            type="submit"
            aria-label="Continue finance question in chat"
            disabled={!prompt.trim()}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/15 text-white transition hover:bg-white/25 disabled:opacity-35"
          >
            <ArrowUp aria-hidden="true" size={18} />
          </button>
        </form>
        <p className="mt-3 text-center text-xs text-slate-500">
          TaskForceAI can make mistakes and isn’t a licensed investment adviser or tax preparer.
        </p>

        <div className="mt-12">
          <h2 className="text-xl font-semibold text-white">Get started</h2>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            {financeStarters.map((starter) => {
              const StarterIcon = starter.icon;
              return (
                <button
                  key={starter.title}
                  type="button"
                  onClick={() => setPrompt(starter.description)}
                  className="rounded-2xl border border-white/15 bg-white/[0.09] p-5 text-left transition hover:border-white/25 hover:bg-white/[0.13]"
                >
                  <StarterIcon aria-hidden="true" className="text-emerald-400" size={21} />
                  <span className="mt-5 block font-semibold text-white">{starter.title}</span>
                  <span className="mt-1 block text-sm leading-5 text-slate-400">
                    {starter.description}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-14 flex items-center gap-2 border-b border-white/10 pb-4">
          {(['dashboard', 'accounts'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={tab === value}
              onClick={() => setTab(value)}
              className={`rounded-full px-4 py-2 text-sm font-medium capitalize transition ${
                tab === value
                  ? 'bg-white/20 text-white'
                  : 'text-slate-400 hover:bg-white/10 hover:text-white'
              }`}
            >
              {value}
            </button>
          ))}
        </div>

        <div className="mt-6 rounded-3xl border border-white/10 bg-white/[0.04] p-5 sm:p-7">
          <ProfileFinanceSection />
        </div>
      </div>
    </section>
  );
}
