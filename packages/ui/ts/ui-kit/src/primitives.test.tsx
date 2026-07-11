import { fireEvent, render, screen } from '@testing-library/react';
import { createRef, type FormEvent } from 'react';
import { describe, expect, it, vi } from 'bun:test';
import '../../../../../tests/setup/dom';

import { Badge } from './badge';
import { Button } from './button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './card';
import { Input } from './input';
import { Separator } from './separator';
import { Switch } from './switch';
import { Textarea } from './textarea';
import { cn } from './utils';

describe('ui-kit primitives', () => {
  it('uses a non-submitting button by default while preserving explicit types', () => {
    const onSubmit = vi.fn((event: FormEvent<HTMLFormElement>) => event.preventDefault());

    render(
      <form onSubmit={onSubmit}>
        <Button>Default action</Button>
        <Button type="submit">Submit action</Button>
      </form>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Default action' }));
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Submit action' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('renders button variants through Slot when asChild is enabled', () => {
    render(
      <Button asChild size="sm" variant="secondary">
        <a href="/dashboard">Dashboard</a>
      </Button>
    );

    const link = screen.getByRole('link', { name: 'Dashboard' });
    expect(link).toHaveAttribute('href', '/dashboard');
    expect(link).toHaveClass('bg-secondary');
    expect(link).toHaveClass('h-8');
  });

  it('forwards input defaults, refs, and caller class overrides', () => {
    const ref = createRef<HTMLInputElement>();

    render(<Input ref={ref} aria-label="Name" className="px-10" />);

    const input = screen.getByLabelText('Name');
    expect(input).toHaveAttribute('type', 'text');
    expect(ref.current).toBe(input as HTMLInputElement);
    expect(input).toHaveClass('px-10');
    expect(input).not.toHaveClass('px-3');
  });

  it('forwards textarea refs and caller class overrides', () => {
    const ref = createRef<HTMLTextAreaElement>();

    render(<Textarea ref={ref} aria-label="Notes" className="min-h-32" />);

    const textarea = screen.getByLabelText('Notes');
    expect(ref.current).toBe(textarea as HTMLTextAreaElement);
    expect(textarea).toHaveClass('min-h-32');
    expect(textarea).not.toHaveClass('min-h-[80px]');
  });

  it('renders badge and card composition primitives with caller classes', () => {
    render(
      <Card className="shadow-none">
        <CardHeader>
          <CardTitle>Project</CardTitle>
          <CardDescription>Shared UI container</CardDescription>
        </CardHeader>
        <CardContent>
          <Badge variant="outline" className="border-dashed">
            Active
          </Badge>
        </CardContent>
        <CardFooter>Footer</CardFooter>
      </Card>
    );

    expect(screen.getByText('Project')).toHaveClass('font-semibold');
    expect(screen.getByText('Shared UI container')).toHaveClass('text-muted-foreground');
    expect(screen.getByText('Active')).toHaveClass('border-dashed');
    expect(screen.getByText('Footer')).toHaveClass('flex');
  });

  it('applies separator orientation defaults and vertical variants', () => {
    const { rerender } = render(<Separator data-testid="separator" />);

    const horizontal = screen.getByTestId('separator');
    expect(horizontal).toHaveAttribute('data-orientation', 'horizontal');
    expect(horizontal).toHaveClass('h-[1px]');
    expect(horizontal).toHaveClass('w-full');

    rerender(<Separator data-testid="separator" orientation="vertical" decorative={false} />);

    const vertical = screen.getByTestId('separator');
    expect(vertical).toHaveAttribute('data-orientation', 'vertical');
    expect(vertical).toHaveAttribute('role', 'separator');
    expect(vertical).toHaveClass('h-full');
    expect(vertical).toHaveClass('w-[1px]');
  });

  it('passes switch checked state changes through Radix', () => {
    const onCheckedChange = vi.fn();

    render(<Switch checked={false} onCheckedChange={onCheckedChange} aria-label="Sync enabled" />);

    const toggle = screen.getByRole('switch', { name: 'Sync enabled' });
    expect(toggle).toHaveAttribute('data-state', 'unchecked');

    fireEvent.click(toggle);

    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('merges conditional and conflicting Tailwind classes', () => {
    const hiddenClass = false;

    expect(cn('px-2 text-sm', hiddenClass ? 'hidden' : false, 'px-4')).toBe('text-sm px-4');
  });
});
