import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { BenchmarkTable } from './BenchmarkTable';

describe('BenchmarkTable', () => {
  it('renders benchmark table with all providers (Hardening TF-0289)', () => {
    const html = renderToStaticMarkup(<BenchmarkTable />);

    expect(html).toContain('Benchmark');
    expect(html).toContain('Sentinel');
    expect(html).toContain('TaskForceAI model');
    expect(html).toContain('Gemini 3.1 Pro Preview');
    expect(html).toContain('GPT-5.5 (xhigh)');
    expect(html).toContain('Claude Fable 5 (with fallback)');
    expect(html).toContain('Grok 4.3 (high)');
    expect(html).not.toMatch(/GLM-5\.2|glm-5\.2|zai/i);

    expect(html).toContain('GPQA Diamond');
    expect(html).toContain('Artificial Analysis Index v4.1');
    expect(html).toContain('Terminal-Bench v2.1');
    expect(html).not.toContain('IFBench');
    expect(html).toContain('href="https://artificialanalysis.ai/leaderboards/models"');
  });
});
