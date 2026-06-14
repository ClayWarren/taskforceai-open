import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'bun:test';

import { Button, buttonVariants } from './button';

describe('Button', () => {
  const renderButton = (props: React.ComponentProps<typeof Button> = {}) => {
    render(<Button {...props} />);
    return screen.getByRole(props.asChild ? 'link' : 'button');
  };

  describe('rendering', () => {
    it('renders button with children', () => {
      render(<Button>Click me</Button>);
      expect(screen.getByRole('button', { name: 'Click me' })).toBeTruthy();
    });

    it('renders as button element by default', () => {
      render(<Button>Test</Button>);
      const button = screen.getByRole('button');
      expect(button.tagName).toBe('BUTTON');
    });
  });

  describe('variants', () => {
    it('applies default variant styles', () => {
      const button = renderButton({ children: 'Default' });
      expect(button.className).toContain('bg-primary');
    });

    it('applies destructive variant styles', () => {
      const button = renderButton({ variant: 'destructive', children: 'Delete' });
      expect(button.className).toContain('bg-destructive');
    });

    it('applies outline variant styles', () => {
      const button = renderButton({ variant: 'outline', children: 'Outline' });
      expect(button.className).toContain('border');
    });

    it('applies secondary variant styles', () => {
      const button = renderButton({ variant: 'secondary', children: 'Secondary' });
      expect(button.className).toContain('bg-secondary');
    });

    it('applies ghost variant styles', () => {
      const button = renderButton({ variant: 'ghost', children: 'Ghost' });
      expect(button.className).toContain('hover:bg-accent');
    });

    it('applies link variant styles', () => {
      const button = renderButton({ variant: 'link', children: 'Link' });
      expect(button.className).toContain('underline-offset');
    });
  });

  describe('sizes', () => {
    it('applies default size', () => {
      const button = renderButton({ children: 'Default' });
      expect(button.className).toContain('h-9');
    });

    it('applies small size', () => {
      const button = renderButton({ size: 'sm', children: 'Small' });
      expect(button.className).toContain('h-8');
    });

    it('applies large size', () => {
      const button = renderButton({ size: 'lg', children: 'Large' });
      expect(button.className).toContain('h-10');
    });

    it('applies icon size', () => {
      const button = renderButton({ size: 'icon', children: '🔍' });
      expect(button.className).toContain('w-9');
    });
  });

  describe('props', () => {
    it('passes through native button props', () => {
      const button = renderButton({ type: 'submit', disabled: true, children: 'Submit' });
      expect(button.getAttribute('type')).toBe('submit');
      expect(button.hasAttribute('disabled')).toBeTrue();
    });

    it('applies custom className', () => {
      const button = renderButton({ className: 'custom-class', children: 'Custom' });
      expect(button.className).toContain('custom-class');
    });
  });

  describe('asChild', () => {
    it('renders as Slot when asChild is true', () => {
      render(
        <Button asChild>
          <a href="/link">Link Button</a>
        </Button>
      );
      const link = screen.getByRole('link', { name: 'Link Button' });
      expect(link).toBeTruthy();
      expect(link.tagName).toBe('A');
    });
  });

  describe('buttonVariants', () => {
    it('exports buttonVariants function', () => {
      expect(typeof buttonVariants).toBe('function');
    });

    it('generates class string', () => {
      const classes = buttonVariants({ variant: 'default', size: 'default' });
      expect(typeof classes).toBe('string');
      expect(classes.length).toBeGreaterThan(0);
    });
  });
});
