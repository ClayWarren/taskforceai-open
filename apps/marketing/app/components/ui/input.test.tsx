import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'bun:test';

import { Input } from './input';

describe('Input', () => {
  describe('rendering', () => {
    it('renders input element', () => {
      render(<Input data-testid="input" />);
      const input = screen.getByTestId('input');
      expect(input).toBeTruthy();
      expect(input).toBeInstanceOf(HTMLInputElement);
    });

    it('defaults to text type', () => {
      render(<Input data-testid="input" />);
      const input = screen.getByTestId('input');
      expect(input.getAttribute('type')).toBe('text');
    });
  });

  describe('types', () => {
    it('supports email type', () => {
      render(<Input type="email" data-testid="input" />);
      const input = screen.getByTestId('input');
      expect(input.getAttribute('type')).toBe('email');
    });

    it('supports password type', () => {
      render(<Input type="password" data-testid="input" />);
      const input = screen.getByTestId('input');
      expect(input.getAttribute('type')).toBe('password');
    });

    it('supports number type', () => {
      render(<Input type="number" data-testid="input" />);
      const input = screen.getByTestId('input');
      expect(input.getAttribute('type')).toBe('number');
    });

    it('supports search type', () => {
      render(<Input type="search" data-testid="input" />);
      const input = screen.getByTestId('input');
      expect(input.getAttribute('type')).toBe('search');
    });
  });

  describe('styling', () => {
    it('applies base input styles', () => {
      render(<Input data-testid="input" />);
      const input = screen.getByTestId('input');
      expect(input.className).toContain('flex');
      expect(input.className).toContain('h-10');
      expect(input.className).toContain('w-full');
      expect(input.className).toContain('rounded-md');
      expect(input.className).toContain('border');
    });

    it('merges custom className', () => {
      render(<Input className="custom-input" data-testid="input" />);
      const input = screen.getByTestId('input');
      expect(input.className).toContain('custom-input');
      expect(input.className).toContain('border');
    });
  });

  describe('props', () => {
    it('supports placeholder', () => {
      render(<Input placeholder="Enter text..." data-testid="input" />);
      const input = screen.getByTestId('input');
      expect(input.getAttribute('placeholder')).toBe('Enter text...');
    });

    it('supports disabled state', () => {
      render(<Input disabled data-testid="input" />);
      const input = screen.getByTestId('input');
      expect((input as HTMLInputElement).disabled).toBe(true);
    });

    it('supports required attribute', () => {
      render(<Input required data-testid="input" />);
      const input = screen.getByTestId('input');
      expect(input.hasAttribute('required')).toBe(true);
    });

    it('supports readOnly attribute', () => {
      render(<Input readOnly data-testid="input" />);
      const input = screen.getByTestId('input');
      expect((input as HTMLInputElement).readOnly).toBe(true);
    });

    it('supports value and onChange', async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      const handleChange = vi.fn();
      render(<Input value="" onChange={handleChange} data-testid="input" />);
      const input = screen.getByTestId('input');

      await user.type(input, 'new value');
      expect(handleChange).toHaveBeenCalled();
    });

    it('supports defaultValue', () => {
      render(<Input defaultValue="default" data-testid="input" />);
      const input = screen.getByTestId('input');
      expect((input as HTMLInputElement).value).toBe('default');
    });
  });

  describe('ref forwarding', () => {
    it('forwards ref to input element', () => {
      let inputRef: HTMLInputElement | null = null;
      render(
        <Input
          ref={(el) => {
            inputRef = el;
          }}
        />
      );
      expect(inputRef).toBeTruthy();
      if (!inputRef) {
        throw new Error('Expected input ref to be assigned');
      }
      expect(inputRef).toBeInstanceOf(HTMLInputElement);
    });
  });

  describe('accessibility', () => {
    it('supports aria-label', () => {
      render(<Input aria-label="Search input" data-testid="input" />);
      const input = screen.getByTestId('input');
      expect(input.getAttribute('aria-label')).toBe('Search input');
    });

    it('supports aria-describedby', () => {
      render(<Input aria-describedby="help-text" data-testid="input" />);
      const input = screen.getByTestId('input');
      expect(input.getAttribute('aria-describedby')).toBe('help-text');
    });

    it('supports id for label association', () => {
      render(<Input id="my-input" data-testid="input" />);
      const input = screen.getByTestId('input');
      expect(input.getAttribute('id')).toBe('my-input');
    });
  });
});
