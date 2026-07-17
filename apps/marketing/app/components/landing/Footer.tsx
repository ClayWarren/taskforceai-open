import type { ReactNode } from 'react';

import { RouterAwareLink } from '../RouterAwareLink';

export function FooterLink({
  href,
  children,
  external,
}: {
  href: string;
  children: ReactNode;
  external?: boolean;
}) {
  const content = (
    <span className="text-sm text-slate-600 transition-colors hover:text-slate-900 dark:text-slate-400 dark:hover:text-white">
      {children}
    </span>
  );

  return (
    <RouterAwareLink
      href={href}
      target={external ? '_blank' : undefined}
      rel={external ? 'noopener noreferrer' : undefined}
      className="no-underline"
    >
      {content}
    </RouterAwareLink>
  );
}

export function LandingFooter() {
  return (
    <footer className="mt-16 border-t border-slate-200 pt-16 pb-8 dark:border-slate-800">
      <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-4">
          <p className="text-sm font-semibold text-slate-900 dark:text-white">TaskForceAI</p>
          <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-400">
            Multi-agent orchestration across web, desktop, terminal, mobile, SDKs, and REST API.
          </p>
        </div>
        <div className="flex flex-col space-y-3">
          <p className="text-sm font-semibold text-slate-900 dark:text-white">Product</p>
          <FooterLink href="/home#platforms">Platforms</FooterLink>
          <FooterLink href="/benchmarks">Benchmarks</FooterLink>
          <FooterLink href="/pricing">Pricing</FooterLink>
          <FooterLink href="/enterprise">Enterprise</FooterLink>
          <FooterLink href="https://taskforceai.chat" external>
            Web App
          </FooterLink>
          <FooterLink href="/downloads">Downloads</FooterLink>
          <FooterLink href="/changelog">Changelog</FooterLink>
        </div>
        <div className="flex flex-col space-y-3">
          <p className="text-sm font-semibold text-slate-900 dark:text-white">Developers</p>
          <FooterLink href="https://docs.taskforceai.chat/docs" external>
            Docs
          </FooterLink>
          <FooterLink href="https://console.taskforceai.chat" external>
            API Console
          </FooterLink>
          <FooterLink href="https://docs.taskforceai.chat/docs/typescript-sdk" external>
            TypeScript SDK
          </FooterLink>
          <FooterLink href="https://docs.taskforceai.chat/docs/python-sdk" external>
            Python SDK
          </FooterLink>
          <FooterLink href="https://docs.taskforceai.chat/docs/rust-sdk" external>
            Rust SDK
          </FooterLink>
          <FooterLink href="https://docs.taskforceai.chat/docs/go-sdk" external>
            Go SDK
          </FooterLink>
          <FooterLink href="https://docs.taskforceai.chat/docs/api" external>
            REST API
          </FooterLink>
        </div>
        <div className="flex flex-col space-y-3">
          <p className="text-sm font-semibold text-slate-900 dark:text-white">Company</p>
          <FooterLink href="/company">About</FooterLink>
          <FooterLink href="/blog">Blog</FooterLink>
          <FooterLink href="https://x.com/taskforceai_us" external>
            Follow on X
          </FooterLink>
          <FooterLink href="https://github.com/ClayWarren/taskforceai-open" external>
            GitHub
          </FooterLink>
          <FooterLink href="https://status.taskforceai.chat" external>
            Status
          </FooterLink>
          <FooterLink href="/help">Help Center</FooterLink>
        </div>
      </div>
      <div className="mt-12 flex flex-wrap items-center justify-between gap-6 border-t border-slate-200 pt-8 dark:border-slate-800/50">
        <div className="flex items-center gap-6">
          <FooterLink href="/terms">Terms</FooterLink>
          <FooterLink href="/privacy">Privacy</FooterLink>
        </div>
        <p className="text-sm text-slate-500">
          © {new Date().getFullYear()} TaskForceAI. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
