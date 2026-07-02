import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'bun:test';

describe('ViewOnGithubButton', () => {
  it('opens GitHub links in a new tab without exposing window.opener', async () => {
    const { ViewOnGithubButton } = await import('./ViewOnGithubButton');

    render(<ViewOnGithubButton href="https://github.com/TaskForceAI/taskforceai" />);

    const link = screen.getByRole('link', { name: /view on github/i });
    expect(link.getAttribute('href')).toBe('https://github.com/TaskForceAI/taskforceai');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });
});
