import { render } from '@testing-library/react';
import { describe, expect, it } from 'bun:test';

import { StructuredData } from '@taskforceai/ui-kit/StructuredData';

describe('StructuredData', () => {
  it('renders JSON-LD scripts', () => {
    const { container } = render(<StructuredData />);
    const scripts = container.querySelectorAll('script[type="application/ld+json"]');

    expect(scripts).toHaveLength(3);

    const types = Array.from(scripts).map((s) => JSON.parse(s.innerHTML)['@type']);
    expect(types).toContain('Organization');
    expect(types).toContain('WebSite');
    expect(types).toContain('SoftwareApplication');
  });

  it('includes proper software application offer', () => {
    const { container } = render(<StructuredData />);
    const scripts = container.querySelectorAll('script[type="application/ld+json"]');
    const softwareScript = Array.from(scripts).find(
      (s) => JSON.parse(s.innerHTML)['@type'] === 'SoftwareApplication'
    );

    expect(softwareScript).toBeTruthy();
    const content = JSON.parse(softwareScript?.innerHTML || '{}');
    expect(content.offers.lowPrice).toBe('0');
  });
});
