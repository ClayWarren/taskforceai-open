import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'bun:test';
import React from 'react';

import '../../../../../tests/setup/dom';
import LandingPage from './LandingPage';
import { CTAButton } from './CTAButton';
import { Header } from './Header';
import { Hero } from './Hero';

afterEach(() => {
  cleanup();
});

// Mock next/image
vi.mock('next/image', () => ({
  default: ({
    alt,
    fill: _fill,
    priority: _priority,
    ...props
  }: React.ComponentProps<'img'> & { fill?: boolean; priority?: boolean }) => (
    <img alt={alt} {...props} />
  ),
}));

function setViewportWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: width,
  });
  window.dispatchEvent(new Event('resize'));
}

describe('Landing Components', () => {
  describe('CTAButton', () => {
    it('renders as a link', () => {
      render(<CTAButton href="/test">Click me</CTAButton>);
      const link = screen.getByRole('link', { name: /click me/i });
      expect(link.getAttribute('href')).toBe('/test');
    });

    it('renders with external icon when external', () => {
      render(
        <CTAButton href="https://example.com" external>
          External
        </CTAButton>
      );
      expect(screen.getByText('External')).toBeTruthy();
    });

    it('renders with icon', () => {
      render(
        <CTAButton href="/test" icon={<span data-testid="test-icon" />}>
          With Icon
        </CTAButton>
      );
      expect(screen.getByTestId('test-icon')).toBeTruthy();
    });

    it('renders variants correctly', () => {
      const { rerender } = render(
        <CTAButton href="/test" variant="primary">
          Primary
        </CTAButton>
      );
      expect(screen.getByText('Primary')).toBeTruthy();

      rerender(
        <CTAButton href="/test" variant="secondary">
          Secondary
        </CTAButton>
      );
      expect(screen.getByText('Secondary')).toBeTruthy();
    });

    it('disables prefetching to prevent RSC errors on cross-domain links (Hardening TF-0143)', () => {
      render(<CTAButton href="/downloads">Downloads</CTAButton>);
      const link = screen.getByRole('link', { name: /downloads/i });
      // We expect preload to be false because /downloads might be proxied to the web app
      expect(link.getAttribute('data-preload')).toBe('false');
    });

    it('invokes optional click handlers for anchor buttons', () => {
      const onClick = vi.fn();
      render(
        <CTAButton href="/login" onClick={onClick}>
          Start
        </CTAButton>
      );

      fireEvent.click(screen.getByRole('link', { name: /start/i }));

      expect(onClick).toHaveBeenCalledTimes(1);
    });
  });

  describe('Header', () => {
    it('renders navigation links', () => {
      setViewportWidth(1280);
      const links = [
        { label: 'Link 1', href: '#1' },
        { label: 'Link 2', href: '/2' },
      ];
      render(<Header navigationLinks={links} />);
      expect(screen.getByText('Link 1')).toBeTruthy();
      expect(screen.getByText('Link 2')).toBeTruthy();
    });
  });

  describe('Hero', () => {
    it('renders headline and description', () => {
      render(<Hero cta={<button>CTA</button>} />);
      expect(screen.getByText(/Multi-agent orchestration/i)).toBeTruthy();
      expect(screen.getByText(/Four parallel agents/i)).toBeTruthy();
    });
  });

  describe('LandingPage', () => {
    it('renders full landing page structure', () => {
      render(<LandingPage />);
      expect(screen.getByText(/Pick your surface/i)).toBeTruthy();
      expect(
        screen.getByLabelText(/Agent Teams demo solving and verifying the one millionth prime/i)
      ).toBeTruthy();
      expect(
        document.querySelector('source[src="/videos/agent-teams-millionth-prime-demo.mp4"]')
      ).toBeTruthy();
      expect(screen.getByText(/Official SDKs/i)).toBeTruthy();
    });

    it('renders blog section', () => {
      render(<LandingPage />);
      expect(screen.getByText('TaskForceAI Blog')).toBeTruthy();
      expect(screen.getByText(/Latest from TaskForceAI/i)).toBeTruthy();
      expect(
        screen.getByText('Artifacts and hosted sites turn answers into shippable work')
      ).toBeTruthy();
      expect(
        screen.getByText('Agent Teams now work across every TaskForceAI surface')
      ).toBeTruthy();
      expect(screen.getByText('Computer use comes to your machine and the cloud')).toBeTruthy();
    });
  });
});
