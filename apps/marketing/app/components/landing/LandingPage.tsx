import { ArrowRight, Command, Globe, Terminal } from 'lucide-react';

import { env } from '../../env';
import { landingBlogPosts } from '@/blog-data/posts';
import { isExternalHref, resolveMobileIosUrl, resolveMobileAndroidUrl } from '@/lib/mobile-links';
import { BenchmarkTable } from './BenchmarkTable';
import { CTAButton } from './CTAButton';
import Hero from './Hero';
import ResourcesSection from './Resources';
import SurfacesSection from './Surfaces';
import { type BlogPostConfig, type ResourceConfig, type SurfaceCardConfig } from './types';

const mobileIosUrl = resolveMobileIosUrl(env.NEXT_PUBLIC_MOBILE_IOS_APP_URL);
const mobileAndroidUrl = resolveMobileAndroidUrl(
  env.NEXT_PUBLIC_MOBILE_ANDROID_APP_URL,
  '/mobile#android-install'
);

const mobileIosIsExternal = isExternalHref(mobileIosUrl);
const mobileAndroidIsExternal = isExternalHref(mobileAndroidUrl);

const surfaces: SurfaceCardConfig[] = [
  {
    name: 'Web',
    description:
      'Access TaskForceAI from any browser. Monitor agents, review results, and manage conversations.',
    primaryCta: {
      label: 'Launch web app',
      href: 'https://taskforceai.chat',
      variant: 'primary' as const,
      external: true,
    },
    accent: 'from-blue-500/40 via-blue-400/10 to-transparent',
  },
  {
    name: 'Desktop',
    description:
      'Native apps for macOS, Windows, and Linux with offline support and automatic updates.',
    primaryCta: {
      label: 'Download apps',
      href: '/downloads',
      variant: 'primary',
    },
    secondaryCta: {
      label: 'Install via Homebrew',
      href: 'https://docs.taskforceai.chat/docs/desktop/homebrew',
      variant: 'secondary',
    },
    accent: 'from-purple-500/40 via-purple-400/10 to-transparent',
  },
  {
    name: 'Mobile',
    description:
      'Stay connected on the go. iOS and Android apps for managing tasks wherever you are.',
    primaryCta: {
      label: 'Download iOS App',
      href: mobileIosUrl,
      variant: 'primary',
      external: mobileIosIsExternal,
    },
    secondaryCta: {
      label: 'Join Android Beta',
      href: mobileAndroidUrl,
      variant: 'secondary',
      external: mobileAndroidIsExternal,
    },
    accent: 'from-cyan-500/40 via-cyan-400/10 to-transparent',
  },
];

const developerResources: ResourceConfig[] = [
  {
    icon: Command,
    category: 'SDK',
    stack: 'Multi-language',
    slug: 'official-sdks',
    title: 'Official SDKs',
    description:
      'Typed clients with status streams, hooks, and forward-compatible orchestration options for your preferred stack.',
    docsHref: 'https://docs.taskforceai.chat/docs/sdks',
    links: [
      { label: 'TypeScript', href: 'https://docs.taskforceai.chat/docs/typescript-sdk' },
      { label: 'Python', href: 'https://docs.taskforceai.chat/docs/python-sdk' },
      { label: 'Go SDK', href: 'https://docs.taskforceai.chat/docs/go-sdk' },
      { label: 'Rust', href: 'https://docs.taskforceai.chat/docs/rust-sdk' },
    ],
  },
  {
    icon: Terminal,
    category: 'CLI',
    stack: 'Native Installer',
    slug: 'cli',
    title: 'Terminal Interface',
    description:
      'Powerful command-line interface for developers. Manage agents and tasks directly from your shell.',
    docsHref: 'https://docs.taskforceai.chat/docs/cli',
  },
  {
    icon: Globe,
    category: 'REST API',
    stack: 'OpenAPI + SSE',
    slug: 'rest-api',
    title: 'REST API',
    description:
      'Stable, versioned endpoints with streaming support, developer API keys, and Postman-ready collections.',
    docsHref: 'https://docs.taskforceai.chat/docs/api',
  },
];

const blogPosts: BlogPostConfig[] = landingBlogPosts.map((post) => ({
  slug: post.slug,
  title: post.title,
  description: post.summary,
  href: `/blog/${post.slug}`,
  publishedAt: post.date,
  readTime: post.readTime,
  tag: post.tag,
}));

export default function LandingPage() {
  return (
    <div className="flex flex-col gap-24 pt-12">
      <div className="flex flex-col gap-24">
        <Hero
          cta={
            <div className="flex flex-wrap items-center justify-center gap-3">
              <CTAButton
                href="https://taskforceai.chat"
                variant="primary"
                icon={<ArrowRight className="h-4 w-4" />}
                external
              >
                Launch web app
              </CTAButton>
              <CTAButton href="https://docs.taskforceai.chat/docs" variant="ghost">
                View docs
              </CTAButton>
            </div>
          }
        />

        <SurfacesSection surfaces={surfaces} />

        <DemoPreviewSection />

        <ResourcesSection resources={developerResources} />

        <section id="benchmarks" aria-labelledby="benchmarks-heading" className="space-y-10">
          <div className="mx-auto flex max-w-3xl flex-col gap-4 text-center">
            <p className="text-xs font-semibold tracking-[0.28em] text-slate-600 uppercase dark:text-slate-400">
              Benchmarks
            </p>
            <h2
              id="benchmarks-heading"
              className="text-3xl font-semibold text-slate-900 md:text-4xl lg:text-5xl dark:text-white"
            >
              Current frontier model comparisons
            </h2>
            <p className="text-base text-slate-700 md:text-lg dark:text-slate-300">
              Sentinel, TaskForceAI&apos;s model, is shown alongside GPT-5.5 (xhigh), Gemini 3.1 Pro
              Preview, Claude Fable 5 (with fallback), and Grok 4.3 (high) using current Artificial
              Analysis benchmark comparisons.
            </p>
          </div>
          <BenchmarkTable />
          <div className="flex justify-center">
            <CTAButton
              href="/benchmarks"
              variant="secondary"
              icon={<ArrowRight className="h-4 w-4" />}
            >
              View methodology
            </CTAButton>
          </div>
        </section>

        <section id="blog" aria-labelledby="blog-heading" className="space-y-10">
          <div className="mx-auto flex max-w-3xl flex-col gap-4 text-center">
            <p className="text-xs font-semibold tracking-[0.28em] text-slate-600 uppercase dark:text-slate-400">
              TaskForceAI Blog
            </p>
            <h2
              id="blog-heading"
              className="text-3xl font-semibold text-slate-900 md:text-4xl lg:text-5xl dark:text-white"
            >
              Latest from TaskForceAI
            </h2>
            <p className="text-base text-slate-700 md:text-lg dark:text-slate-300">
              Product news, launch notes, and deeper dives on the agent workflows powering the
              platform.
            </p>
          </div>
          <div className="grid gap-6 lg:grid-cols-3">
            {blogPosts.map((post) => (
              <BlogPostCard key={post.slug} post={post} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function DemoPreviewSection() {
  return (
    <section id="demo" aria-labelledby="demo-heading" className="space-y-8">
      <div className="mx-auto flex max-w-3xl flex-col gap-4 text-center">
        <p className="text-xs font-semibold tracking-[0.28em] text-sky-700 uppercase dark:text-sky-300">
          Product demo
        </p>
        <h2
          id="demo-heading"
          className="text-3xl font-semibold text-slate-900 md:text-4xl lg:text-5xl dark:text-white"
        >
          See TaskForceAI coordinate the work
        </h2>
        <p className="text-base text-slate-700 md:text-lg dark:text-slate-300">
          Watch agent teams split a real task, stream progress, verify the result, and deliver the
          final answer in one flow.
        </p>
      </div>

      <div className="group relative overflow-hidden rounded-[2rem] border border-white/10 bg-slate-950 shadow-2xl shadow-sky-500/10 transition duration-300 hover:border-sky-300/40 hover:shadow-sky-500/20">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-sky-200/60 to-transparent" />
        <video
          aria-label="Agent Teams demo solving and verifying the one millionth prime"
          className="relative aspect-video w-full bg-slate-950"
          autoPlay
          controls
          loop
          muted
          playsInline
          preload="metadata"
        >
          <source src="/videos/agent-teams-millionth-prime-demo.mp4" type="video/mp4" />
        </video>
      </div>
    </section>
  );
}

function BlogPostCard({ post }: { post: BlogPostConfig }) {
  return (
    <article className="group flex h-full flex-col justify-between gap-6 rounded-2xl border border-slate-200 bg-white/70 p-6 shadow-xl shadow-blue-500/5 backdrop-blur-xl transition-all hover:border-blue-500/30 hover:shadow-blue-500/10 dark:border-slate-800 dark:bg-slate-900/60">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3 text-xs font-semibold tracking-wider text-slate-600 uppercase dark:text-slate-400">
          <span className="rounded-full border border-slate-200 bg-slate-900/5 px-3 py-1 text-[10px] text-slate-900 dark:border-white/10 dark:bg-white/5 dark:text-white">
            {post.tag}
          </span>
          <span aria-hidden="true" className="text-white/20">
            •
          </span>
          <span>{post.publishedAt}</span>
        </div>
        <h3 className="text-2xl font-semibold text-slate-900 transition-colors group-hover:text-blue-400 dark:text-white">
          {post.title}
        </h3>
        <p className="text-base leading-relaxed text-slate-700 dark:text-slate-300">
          {post.description}
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600 dark:text-slate-400">
        <span>{post.readTime}</span>
        <CTAButton href={post.href} variant="link" icon={<ArrowRight className="h-4 w-4" />}>
          Read the post
        </CTAButton>
      </div>
    </article>
  );
}
