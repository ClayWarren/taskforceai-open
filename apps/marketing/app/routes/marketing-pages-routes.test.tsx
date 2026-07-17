import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'bun:test';
import React from 'react';

let AboutRoute: any;
let MobilePage: React.ComponentType<{
  iosDownloadUrl?: string;
  androidDownloadUrl?: string;
}>;
let SDKRoute: any;
let CompanyRoute: any;
let EnterpriseRoute: any;
let BlogIndexRoute: any;
let BlogBenchmarksRoute: any;
let BenchmarksRoute: any;
let BlogArtifactsRoute: any;
let BlogIntroducingRoute: any;
let BlogAgentTeamsRoute: any;
let BlogComputerUseRoute: any;
let BlogDesktopMobileRoute: any;
let BlogGeneratedFilesRoute: any;
let BlogFinanceRoute: any;
let BlogLocalCodingRoute: any;
let BlogMediaGenerationRoute: any;
let BlogReviewableMemoryRoute: any;
let BlogWebSearchRoute: any;

beforeAll(async () => {
  ({ Route: AboutRoute } = await import('./about'));
  ({ MobilePage } = await import('./mobile/index'));
  ({ Route: SDKRoute } = await import('./sdk/index'));
  ({ Route: CompanyRoute } = await import('./company/index'));
  ({ Route: EnterpriseRoute } = await import('./enterprise/index'));
  ({ Route: BlogIndexRoute } = await import('./blog.index'));
  ({ Route: BlogBenchmarksRoute } = await import('./blog.benchmarks'));
  ({ Route: BenchmarksRoute } = await import('./benchmarks'));
  ({ Route: BlogArtifactsRoute } = await import('./blog.artifacts-and-sites'));
  ({ Route: BlogIntroducingRoute } = await import('./blog.introducing-taskforceai'));
  ({ Route: BlogAgentTeamsRoute } = await import('./blog.agent-teams-everywhere'));
  ({ Route: BlogComputerUseRoute } = await import('./blog.computer-use-local-and-virtual'));
  ({ Route: BlogDesktopMobileRoute } = await import('./blog.desktop-mobile-pairing'));
  ({ Route: BlogGeneratedFilesRoute } = await import('./blog.generated-files-in-chat'));
  ({ Route: BlogFinanceRoute } = await import('./blog.finance-workflows-and-plaid'));
  ({ Route: BlogLocalCodingRoute } = await import('./blog.local-coding-workspace'));
  ({ Route: BlogMediaGenerationRoute } = await import('./blog.media-generation'));
  ({ Route: BlogReviewableMemoryRoute } = await import('./blog.reviewable-memory'));
  ({ Route: BlogWebSearchRoute } = await import('./blog.web-search-and-code-execution'));
});

describe('Marketing routes: about/mobile/sdk/company/enterprise/blog', () => {
  it('renders the about page with orchestration steps and primary CTAs', () => {
    const AboutPage = AboutRoute.options.component as React.ComponentType;
    render(<AboutPage />);

    expect(screen.getByText('Building the future of AI orchestration')).toBeTruthy();
    expect(screen.getByText('Parallel Processing')).toBeTruthy();
    expect(screen.getByText('Synthesis')).toBeTruthy();
    expect(screen.getByText('Validation')).toBeTruthy();
    expect(screen.getByText('Delivery')).toBeTruthy();

    expect(screen.getByRole('link', { name: 'Get Started' }).getAttribute('href')).toBe(
      'https://taskforceai.chat/login'
    );
    expect(screen.getByRole('link', { name: /View documentation/ }).getAttribute('href')).toBe(
      'https://docs.taskforceai.chat/docs'
    );
  });

  it('renders mobile route download links with external/internal behavior', () => {
    render(
      <MobilePage
        iosDownloadUrl="https://apps.apple.com/us/app/taskforceai/id6754827533"
        androidDownloadUrl="/mobile/android-beta"
      />
    );

    const iosLink = screen.getByRole('link', { name: /Install for iOS/i });
    expect(iosLink.getAttribute('href')).toBe(
      'https://apps.apple.com/us/app/taskforceai/id6754827533'
    );
    expect(iosLink.getAttribute('target')).toBe('_blank');
    expect(iosLink.getAttribute('rel')).toBe('noopener noreferrer');
    expect(screen.getByText('Opens App Store')).toBeTruthy();

    const androidLink = screen.getByRole('link', { name: /Install for Android/i });
    expect(androidLink.getAttribute('href')).toBe('/mobile/android-beta');
    expect(androidLink.getAttribute('target')).toBeNull();
    expect(androidLink.getAttribute('data-router-link')).toBe('true');
    expect(screen.getByText('Beta link coming soon')).toBeTruthy();

    expect(screen.getByText('Release checklist')).toBeTruthy();
  });

  it('renders SDK route installation, examples, and docs CTAs', () => {
    const SDKPage = SDKRoute.options.component as React.ComponentType;
    render(<SDKPage />);

    expect(screen.getByText('TaskForceAI SDK')).toBeTruthy();
    expect(screen.getByText('bun add taskforceai-sdk')).toBeTruthy();
    expect(screen.getByText('SDK Examples')).toBeTruthy();
    expect(screen.getByText(/TaskForceAIError/)).toBeTruthy();
    expect(screen.getByText(/Keep the TaskForceAI API key on your server/)).toBeTruthy();
    expect(document.body.textContent).not.toContain("apiKey: 'your-api-key'");

    expect(screen.getByRole('link', { name: 'Get API Key' }).getAttribute('href')).toBe(
      'https://console.taskforceai.chat'
    );
    expect(screen.getByRole('link', { name: 'View API Docs' }).getAttribute('href')).toBe(
      'https://docs.taskforceai.chat/docs'
    );
  });

  it('renders company route principles and platform cards', () => {
    const CompanyPage = CompanyRoute.options.component as React.ComponentType;
    render(<CompanyPage />);

    expect(screen.getByText('What guides us')).toBeTruthy();
    expect(screen.getByText('Multi-Agent by Design')).toBeTruthy();
    expect(screen.getByText('Developer-First')).toBeTruthy();
    expect(screen.getByText('Privacy & Control')).toBeTruthy();

    expect(screen.getByText('One platform, every interface')).toBeTruthy();
    expect(screen.getByText('Web')).toBeTruthy();
    expect(screen.getByText('Desktop')).toBeTruthy();
    expect(screen.getByText('Mobile')).toBeTruthy();
    expect(screen.getByText('CLI')).toBeTruthy();
    expect(screen.getByText('API')).toBeTruthy();
  });

  it('renders enterprise route features and compliance badges', () => {
    const EnterprisePage = EnterpriseRoute.options.component as React.ComponentType;
    render(<EnterprisePage />);

    expect(screen.getByText('Orchestration for the Enterprise')).toBeTruthy();
    expect(screen.getByText('Managed SAML Onboarding')).toBeTruthy();
    expect(screen.getByText('Provisioning Planning')).toBeTruthy();
    expect(screen.getByText('Dedicated Support')).toBeTruthy();

    expect(screen.getByText('Security review available')).toBeTruthy();
    expect(screen.getByText('Data-handling review')).toBeTruthy();
    expect(screen.getByText('Pilot planning')).toBeTruthy();

    const contactSalesLinks = screen.getAllByRole('link', { name: 'Contact Sales' });
    expect(contactSalesLinks.length).toBe(2);
    expect(contactSalesLinks[0]?.getAttribute('href')).toBe('mailto:sales@taskforceai.chat');
  });

  it('renders blog index posts with route links', () => {
    const BlogIndexPage = BlogIndexRoute.options.component as React.ComponentType;
    render(<BlogIndexPage />);

    const benchmarksLink = screen.getByRole('link', { name: 'Frontier Model Benchmarks' });
    expect(benchmarksLink.getAttribute('href')).toBe('/benchmarks');

    const agentTeamsLink = screen.getByRole('link', {
      name: 'Agent Teams now work across every TaskForceAI surface',
    });
    expect(agentTeamsLink.getAttribute('href')).toBe('/blog/agent-teams-everywhere');

    const introducingLink = screen.getByRole('link', { name: 'Introducing TaskForceAI' });
    expect(introducingLink.getAttribute('href')).toBe('/blog/introducing-taskforceai');

    expect(screen.getAllByText('Read more').length).toBe(11);
  });

  it('renders standalone benchmarks page with benchmark table and methodology', () => {
    const BenchmarkPage = BenchmarksRoute.options.component as React.ComponentType;
    render(<BenchmarkPage />);

    expect(screen.getByRole('link', { name: 'Back home' }).getAttribute('href')).toBe('/');
    expect(screen.getAllByText(/Benchmark/i).length).toBeGreaterThan(0);
    expect(screen.getByText('Grok 4.5 (high)')).toBeTruthy();
    expect(document.body.textContent ?? '').not.toMatch(/GLM-5\.2|glm-5\.2|zai/i);
    expect(screen.getByText('Methodology')).toBeTruthy();
    expect(
      screen
        .getByRole('link', { name: 'Artificial Analysis model leaderboards' })
        .getAttribute('href')
    ).toBe('https://artificialanalysis.ai/leaderboards/models');
    expect(
      screen.getByRole('link', { name: 'Intelligence Index v4.1 methodology' }).getAttribute('href')
    ).toBe('https://artificialanalysis.ai/methodology/intelligence-benchmarking');
  });

  it('keeps benchmarks blog path as a compatibility route', () => {
    const BenchmarkPost = BlogBenchmarksRoute.options.component as React.ComponentType;
    render(<BenchmarkPost />);

    expect(
      screen.getByRole('link', { name: 'View canonical benchmarks' }).getAttribute('href')
    ).toBe('/benchmarks');
    expect(screen.getAllByText(/Benchmark/i).length).toBeGreaterThan(0);
    expect(screen.getByText('Methodology')).toBeTruthy();
  });

  it('renders introduction blog post highlights and ship items', () => {
    const IntroducingPost = BlogIntroducingRoute.options.component as React.ComponentType;
    render(<IntroducingPost />);

    expect(screen.getByRole('link', { name: 'Back to blog' }).getAttribute('href')).toBe('/blog');
    expect(screen.getByText('Introducing TaskForceAI')).toBeTruthy();
    expect(screen.getByText(/Open-source CLI with local development support/)).toBeTruthy();
    expect(screen.getByText(/Type-safe SDKs for TypeScript/)).toBeTruthy();
    expect(screen.getByText(/Documentation for the REST API/)).toBeTruthy();
    expect(screen.getByText(/Since launch, we have been focused/)).toBeTruthy();
  });

  it('renders recent product news posts', () => {
    const AgentTeamsPost = BlogAgentTeamsRoute.options.component as React.ComponentType;
    const { unmount } = render(<AgentTeamsPost />);
    expect(screen.getByText('Agent Teams now work across every TaskForceAI surface')).toBeTruthy();
    expect(screen.getByText(/One workflow, many surfaces/)).toBeTruthy();
    unmount();

    const GeneratedFilesPost = BlogGeneratedFilesRoute.options.component as React.ComponentType;
    const generatedView = render(<GeneratedFilesPost />);
    expect(screen.getByText('Generated files now arrive as real chat downloads')).toBeTruthy();
    expect(screen.getByText(/Download cards render below assistant replies/)).toBeTruthy();
    generatedView.unmount();

    const FinancePost = BlogFinanceRoute.options.component as React.ComponentType;
    render(<FinancePost />);
    expect(
      screen.getByText('Finance workflows get secure account context with Plaid')
    ).toBeTruthy();
    expect(screen.getByText(/Read-only Plaid Link support/)).toBeTruthy();
  });

  it('renders every remaining blog route backed by blog data', () => {
    const remainingPosts: Array<{
      route: any;
      title: string;
      highlight: RegExp | string;
      section: RegExp | string;
    }> = [
      {
        route: BlogArtifactsRoute,
        title: 'Artifacts and hosted sites turn answers into shippable work',
        highlight: /Interactive artifacts rendered alongside the conversation/,
        section: 'From answer to artifact',
      },
      {
        route: BlogComputerUseRoute,
        title: 'Computer use comes to your machine and the cloud',
        highlight: /Local computer use that runs on your own machine/,
        section: 'Two ways to give an agent a computer',
      },
      {
        route: BlogDesktopMobileRoute,
        title: 'Pair mobile with desktop and keep working',
        highlight: /Pair the mobile app with desktop/,
        section: 'Work does not stay on one device',
      },
      {
        route: BlogLocalCodingRoute,
        title: 'A real coding workspace, local and remote',
        highlight: /Local coding agent on the desktop app/,
        section: 'Coding where your code lives',
      },
      {
        route: BlogMediaGenerationRoute,
        title: 'Image and video generation, consistent across surfaces',
        highlight: /Image and video generation with inline playback/,
        section: 'Media as a first-class result',
      },
      {
        route: BlogReviewableMemoryRoute,
        title: 'Memory you can see, check, and trust',
        highlight: /Desktop Screen Memory controls/,
        section: 'Memory has to be inspectable',
      },
      {
        route: BlogWebSearchRoute,
        title: 'Sharper web search and sandboxed code execution',
        highlight: /Deeper web search with visible/,
        section: 'Better answers need better inputs',
      },
    ];

    for (const { route, title, highlight, section } of remainingPosts) {
      const BlogPost = route.options.component as React.ComponentType;
      const { unmount } = render(<BlogPost />);

      expect(screen.getByRole('heading', { level: 1, name: title })).toBeTruthy();
      expect(screen.getByText(highlight)).toBeTruthy();
      expect(screen.getByRole('heading', { level: 2, name: section })).toBeTruthy();
      expect(screen.getByRole('link', { name: 'Back to blog' }).getAttribute('href')).toBe('/blog');

      unmount();
    }
  });
});
