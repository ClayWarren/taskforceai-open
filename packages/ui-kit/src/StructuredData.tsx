'use client';

/**
 * Structured data for SEO (JSON-LD)
 */
export function StructuredData({ siteUrl = 'https://taskforceai.chat' }: { siteUrl?: string }) {
  const organizationData = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'TaskForceAI',
    url: siteUrl,
    logo: `${siteUrl}/icon.png`,
    description:
      'Multi-agent AI orchestration platform that coordinates specialized AI agents to solve complex problems through parallel processing and intelligent synthesis.',
    email: 'hello@taskforceai.chat',
    sameAs: ['https://twitter.com/taskforceai', 'https://github.com/taskforceai'],
  };

  const websiteData = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'TaskForceAI',
    url: siteUrl,
    description: 'Multi-agent AI orchestration system for parallel agent execution.',
    publisher: {
      '@type': 'Organization',
      name: 'TaskForceAI',
      url: siteUrl,
    },
  };

  const softwareData = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'TaskForceAI',
    description:
      'Multi-agent AI orchestration system for intelligent task decomposition, parallel execution, and synthesis.',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web, macOS, Windows, Linux, iOS, Android',
    offers: {
      '@type': 'AggregateOffer',
      lowPrice: '0',
      highPrice: '99',
      priceCurrency: 'USD',
      offerCount: '3',
    },
    author: {
      '@type': 'Organization',
      name: 'TaskForceAI',
      url: siteUrl,
    },
    url: siteUrl,
    image: `${siteUrl}/opengraph-image`,
    screenshot: `${siteUrl}/opengraph-image`,
    featureList: [
      'Multi-agent AI orchestration',
      'Parallel processing',
      'Real-time streaming',
      'JavaScript/TypeScript SDK',
      'Python SDK',
      'REST API',
      'Desktop applications',
      'Mobile applications',
      'CLI tool',
    ],
  };

  const structuredData = [organizationData, websiteData, softwareData];

  return (
    <>
      {structuredData.map((data, index) => (
        <script
          key={index}
          type="application/ld+json"
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
        />
      ))}
    </>
  );
}
