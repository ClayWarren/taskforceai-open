import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'bun:test';

import '../../../../../tests/setup/dom';
import { BenchmarkTable } from './BenchmarkTable';

describe('BenchmarkTable', () => {
  it('renders benchmark table with all providers (Hardening TF-0289)', () => {
    render(<BenchmarkTable />);

    // Check for headers
    expect(screen.getByText(/Benchmark/i)).toBeTruthy();
    expect(screen.getByText('Sentinel')).toBeTruthy();
    expect(screen.getByText('Gemini 3.1 Pro Preview')).toBeTruthy();
    expect(screen.getByText('GPT-5.5')).toBeTruthy();
    expect(screen.getByText('Claude Fable 5')).toBeTruthy();
    expect(screen.getByText('Grok 4.3')).toBeTruthy();

    // Check for specific benchmark data
    expect(screen.getByText('GPQA Diamond')).toBeTruthy();
    expect(screen.getByText('Artificial Analysis Index v4.0')).toBeTruthy();
  });
});
