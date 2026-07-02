import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'bun:test';

import { Badge, badgeVariants } from './badge';

describe('Badge', () => {
  describe('rendering', () => {
    it('renders children correctly', () => {
      render(<Badge>New</Badge>);
      expect(screen.getByText('New')).toBeTruthy();
    });

    it('renders as div element', () => {
      render(<Badge data-testid="badge">Test</Badge>);
      const badge = screen.getByTestId('badge');
      expect(badge.tagName).toBe('DIV');
    });
  });

  describe('variants', () => {
    it('applies default variant styles', () => {
      render(<Badge data-testid="badge">Default</Badge>);
      const badge = screen.getByTestId('badge');
      expect(badge.className).toContain('bg-primary');
      expect(badge.className).toContain('text-primary-foreground');
    });

    it('applies secondary variant styles', () => {
      render(
        <Badge variant="secondary" data-testid="badge">
          Secondary
        </Badge>
      );
      const badge = screen.getByTestId('badge');
      expect(badge.className).toContain('bg-secondary');
      expect(badge.className).toContain('text-secondary-foreground');
    });

    it('applies destructive variant styles', () => {
      render(
        <Badge variant="destructive" data-testid="badge">
          Error
        </Badge>
      );
      const badge = screen.getByTestId('badge');
      expect(badge.className).toContain('bg-destructive');
      expect(badge.className).toContain('text-destructive-foreground');
    });

    it('applies outline variant styles', () => {
      render(
        <Badge variant="outline" data-testid="badge">
          Outline
        </Badge>
      );
      const badge = screen.getByTestId('badge');
      expect(badge.className).toContain('text-foreground');
    });
  });

  describe('className merging', () => {
    it('merges custom className with default styles', () => {
      render(
        <Badge className="custom-class" data-testid="badge">
          Test
        </Badge>
      );
      const badge = screen.getByTestId('badge');
      expect(badge.className).toContain('custom-class');
      expect(badge.className).toContain('inline-flex');
      expect(badge.className).toContain('rounded-md');
    });
  });

  describe('base styles', () => {
    it('applies common badge styles', () => {
      render(<Badge data-testid="badge">Test</Badge>);
      const badge = screen.getByTestId('badge');
      expect(badge.className).toContain('inline-flex');
      expect(badge.className).toContain('items-center');
      expect(badge.className).toContain('rounded-md');
      expect(badge.className).toContain('px-2.5');
      expect(badge.className).toContain('py-0.5');
      expect(badge.className).toContain('text-xs');
      expect(badge.className).toContain('font-semibold');
    });
  });

  describe('HTML attributes', () => {
    it('passes through HTML attributes', () => {
      render(
        <Badge id="my-badge" aria-label="Status badge" data-testid="badge">
          Active
        </Badge>
      );
      const badge = screen.getByTestId('badge');
      expect(badge.getAttribute('id')).toBe('my-badge');
      expect(badge.getAttribute('aria-label')).toBe('Status badge');
    });
  });

  describe('badgeVariants', () => {
    it('exports badgeVariants function', () => {
      expect(typeof badgeVariants).toBe('function');
    });

    it('generates class string for default variant', () => {
      const classes = badgeVariants({ variant: 'default' });
      expect(typeof classes).toBe('string');
      expect(classes).toContain('bg-primary');
    });

    it('generates class string for secondary variant', () => {
      const classes = badgeVariants({ variant: 'secondary' });
      expect(classes).toContain('bg-secondary');
    });

    it('generates class string for destructive variant', () => {
      const classes = badgeVariants({ variant: 'destructive' });
      expect(classes).toContain('bg-destructive');
    });

    it('generates class string for outline variant', () => {
      const classes = badgeVariants({ variant: 'outline' });
      expect(classes).toContain('text-foreground');
    });
  });
});
