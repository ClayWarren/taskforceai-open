import { createFileRoute } from '@tanstack/react-router';

import { pageHead } from '@/lib/seo';

const title = 'Download TaskForceAI';
const description = 'Download TaskForceAI desktop apps, mobile betas, CLI, and developer SDKs.';

export const Route = createFileRoute('/downloads/')({
  component: DownloadsPage,
  head: () => pageHead({ title, description, path: '/downloads' }),
});

import { MOBILE_IOS_TESTFLIGHT_URL } from '@/lib/mobile-links';
import { MarketingLayout } from '@/components/layout/MarketingLayout';

export function DownloadsPage() {
  return (
    <MarketingLayout>
      <div className="flex flex-col gap-24 py-16">
        {/* Title */}
        <div className="text-center">
          <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 sm:text-6xl lg:text-7xl dark:text-white">
            Download TaskForceAI
          </h1>
          <p className="mx-auto mt-8 max-w-2xl text-xl leading-relaxed text-slate-600 dark:text-slate-400">
            Choose the version that works best for you. Native apps for every platform with offline
            support.
          </p>
        </div>

        {/* Desktop Apps */}
        <section>
          <div className="mb-12">
            <h2 className="mb-2 text-3xl font-bold text-slate-900 dark:text-white">
              Desktop Application
            </h2>
            <p className="text-slate-600 dark:text-slate-400">
              Native apps for macOS, Windows, and Linux with automatic updates.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3">
            {/* macOS */}
            <DownloadCard
              platform="macOS"
              icon="🍎"
              description="macOS 10.15+ (Catalina or newer)"
              downloads={[
                {
                  label: 'Install with Homebrew',
                  command: 'brew install --cask taskforceai',
                  primary: true,
                },
                {
                  label: 'Download DMG (Apple Silicon)',
                  href: 'https://taskforceai.chat/api/download/desktop/macos-arm64/latest',
                  note: 'For M1, M2, M3, M4 chips',
                },
                {
                  label: 'Download DMG (Intel)',
                  href: 'https://taskforceai.chat/api/download/desktop/macos-x64/latest',
                  note: 'For older Intel-based Macs',
                },
              ]}
            />

            {/* Windows */}
            <DownloadCard
              platform="Windows"
              icon="🪟"
              description="Windows 10+ (64-bit or ARM64)"
              downloads={[
                {
                  label: 'Download Installer (x64)',
                  href: 'https://taskforceai.chat/api/download/desktop/windows-x64/latest',
                  note: 'Individual setup (.exe)',
                  primary: true,
                },
                {
                  label: 'Download MSI (x64)',
                  href: 'https://taskforceai.chat/api/download/desktop/windows-x64-msi/latest',
                  note: 'Enterprise deployment (.msi)',
                },
                {
                  label: 'Download Installer (ARM64)',
                  href: 'https://taskforceai.chat/api/download/desktop/windows-arm64/latest',
                  note: 'Individual setup (.exe)',
                },
                {
                  label: 'Download MSI (ARM64)',
                  href: 'https://taskforceai.chat/api/download/desktop/windows-arm64-msi/latest',
                  note: 'Enterprise deployment (.msi)',
                },
              ]}
            />

            {/* Linux */}
            <DownloadCard
              platform="Linux"
              icon="🐧"
              description="Ubuntu 22.04+, Fedora 36+, and modern distros"
              downloads={[
                {
                  label: 'Download AppImage',
                  href: 'https://taskforceai.chat/api/download/desktop/linux/latest',
                  note: 'Universal AppImage (Recommended)',
                  primary: true,
                },
                {
                  label: 'Download .deb',
                  href: 'https://taskforceai.chat/api/download/desktop/linux-deb/latest',
                  note: 'For Debian/Ubuntu-based systems',
                },
              ]}
            />
          </div>
        </section>

        {/* CLI */}
        <section className="rounded-3xl border border-slate-200 bg-white/60 p-8 md:p-12 dark:border-slate-800 dark:bg-slate-900/40">
          <div className="mb-10">
            <h2 className="mb-2 text-3xl font-bold text-slate-900 dark:text-white">
              Command Line Interface
            </h2>
            <p className="text-slate-600 dark:text-slate-400">
              Powerful terminal client for macOS, Linux, and Windows.
            </p>
          </div>

          <div className="grid gap-8">
            <InstallCommand
              title="Install with curl (macOS, Linux, WSL - Recommended)"
              command="curl -fsSL https://taskforceai.dev/install.sh | bash"
            />
            <InstallCommand
              title="Install with Homebrew"
              command="brew install ClayWarren/taskforceai/taskforceai-cli"
            />
            <InstallCommand
              title="Install with PowerShell (Windows)"
              command="irm https://taskforceai.dev/install.ps1 | iex"
            />
          </div>
        </section>

        {/* Mobile Apps */}
        <section className="py-12 text-center">
          <h2 className="mb-4 text-3xl font-bold text-slate-900 dark:text-white">
            Mobile Applications
          </h2>
          <p className="mx-auto mb-10 max-w-xl text-lg text-slate-600 dark:text-slate-400">
            Take TaskForceAI with you on iOS and Android. Join the beta programs to get early
            access.
          </p>

          <div className="flex flex-wrap justify-center gap-4">
            <a
              href={MOBILE_IOS_TESTFLIGHT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 rounded-2xl bg-slate-900 px-8 py-4 text-sm font-bold text-white shadow-xl transition-all hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100"
            >
              <span className="text-xl">📱</span>
              Join iOS Beta (TestFlight)
            </a>

            <a
              href="/mobile#android-install"
              className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-900/5 px-8 py-4 text-sm font-bold text-slate-900 transition-all hover:bg-slate-900/10 dark:border-white/10 dark:bg-white/5 dark:text-white dark:hover:bg-white/10"
            >
              <span className="text-xl">🤖</span>
              Join Android Beta
            </a>
          </div>
        </section>

        {/* SDKs */}
        <section>
          <div className="mb-12">
            <h2 className="mb-2 text-3xl font-bold text-slate-900 dark:text-white">
              Developer SDKs
            </h2>
            <p className="text-slate-600 dark:text-slate-400">
              Build your own agents and integrations with our official libraries.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <SDKCard
              language="TypeScript / JavaScript"
              command="npm install taskforceai-sdk"
              description="For Node.js, Deno, Bun, and browsers"
            />
            <SDKCard
              language="Python"
              command="pip install taskforceai-python"
              description="For Python 3.8+"
            />
            <SDKCard
              language="Go"
              command="go get github.com/ClayWarren/taskforceai-open/packages/sdk-go"
              description="For Go 1.21+"
            />
            <SDKCard
              language="Rust"
              command="cargo add taskforceai-sdk"
              description="For Rust 1.75+"
            />
          </div>
        </section>
      </div>
    </MarketingLayout>
  );
}

function InstallCommand({ title: commandTitle, command }: { title: string; command: string }) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-bold tracking-wider text-slate-500 uppercase">{commandTitle}</h3>
      <div className="group relative">
        <pre className="overflow-x-auto rounded-xl border border-slate-300 bg-white p-5 font-mono text-sm text-blue-400 shadow-2xl dark:border-slate-700 dark:bg-slate-950">
          <code>{command}</code>
        </pre>
      </div>
    </div>
  );
}

function SDKCard({
  language,
  command,
  description: sdkDescription,
}: {
  language: string;
  command: string;
  description: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white/70 p-6 transition-all hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900/60 dark:hover:border-slate-700">
      <h3 className="mb-1 text-lg font-bold text-slate-900 dark:text-white">{language}</h3>
      <p className="mb-4 text-xs text-slate-500">{sdkDescription}</p>
      <pre className="overflow-x-auto rounded-lg bg-white p-3 font-mono text-xs text-slate-700 dark:bg-slate-950 dark:text-slate-300">
        <code>{command}</code>
      </pre>
    </div>
  );
}

interface DownloadCardProps {
  platform: string;
  icon: string;
  description: string;
  downloads: Array<{
    label: string;
    href?: string;
    command?: string;
    note?: string;
    primary?: boolean;
    disabled?: boolean;
  }>;
}

function DownloadCard({
  platform,
  icon,
  description: platformDescription,
  downloads,
}: DownloadCardProps) {
  return (
    <div className="flex flex-col rounded-2xl border border-slate-200 bg-white/70 p-8 transition-all hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900/60 dark:hover:border-slate-700">
      <div className="mb-8">
        <div className="mb-4 text-4xl">{icon}</div>
        <h3 className="text-2xl font-bold text-slate-900 dark:text-white">{platform}</h3>
        <p className="mt-1 text-sm text-slate-500">{platformDescription}</p>
      </div>

      <div className="flex flex-col gap-4">
        {downloads.map((download, index) => {
          if (download.command) {
            return (
              <div key={index} className="space-y-2">
                <span className="text-[10px] font-bold tracking-widest text-slate-600 uppercase">
                  {download.label}
                </span>
                <pre className="overflow-x-auto rounded-lg bg-white p-3 font-mono text-xs text-blue-400 dark:bg-slate-950">
                  {download.command}
                </pre>
              </div>
            );
          }

          return (
            <div key={index}>
              <a
                href={download.href}
                className={`block w-full rounded-xl py-3 text-center text-sm font-bold transition-all ${
                  download.primary
                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20 hover:bg-blue-500'
                    : 'border border-slate-200 bg-slate-900/5 text-slate-900 hover:bg-slate-900/10 dark:border-white/10 dark:bg-white/5 dark:text-white dark:hover:bg-white/10'
                }`}
              >
                {download.label}
              </a>
              {download.note && (
                <p className="mt-2 text-center text-[10px] text-slate-600">{download.note}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
