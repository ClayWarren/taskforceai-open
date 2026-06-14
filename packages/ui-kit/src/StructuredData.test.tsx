import { render } from '@testing-library/react';
import { describe, expect, it } from 'bun:test';
import '../../../tests/setup/dom';

import { StructuredData } from './StructuredData';

describe('StructuredData', () => {
  it('renders the expected JSON-LD script types', () => {
    const { container } = render(<StructuredData />);
    const scripts = container.querySelectorAll('script[type="application/ld+json"]');

    expect(scripts).toHaveLength(3);
    const types = Array.from(scripts).map((script) => JSON.parse(script.innerHTML)['@type']);
    expect(types).toEqual(['Organization', 'WebSite', 'SoftwareApplication']);
  });

  it('uses the provided site URL in generated metadata', () => {
    const { container } = render(<StructuredData siteUrl="https://example.test" />);
    const scripts = container.querySelectorAll('script[type="application/ld+json"]');
    const [organization, website, software] = Array.from(scripts).map((script) =>
      JSON.parse(script.innerHTML)
    );

    expect(organization.url).toBe('https://example.test');
    expect(organization.logo).toBe('https://example.test/icon.png');
    expect(website.publisher.url).toBe('https://example.test');
    expect(software.image).toBe('https://example.test/opengraph-image');
  });
});
