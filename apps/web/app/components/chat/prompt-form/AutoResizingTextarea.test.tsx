import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'bun:test';

import { AutoResizingTextarea } from './AutoResizingTextarea';

describe('AutoResizingTextarea', () => {
  it('renders with value', () => {
    render(<AutoResizingTextarea value="Hello" onValueChange={vi.fn()} />);
    expect(screen.getByDisplayValue('Hello')).toBeTruthy();
  });

  it.skip('handles onChange from props', () => {
    const onChange = vi.fn();
    const onValueChange = vi.fn();
    render(<AutoResizingTextarea value="" onValueChange={onValueChange} onChange={onChange} />);
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'New value' } });
    expect(onChange).toHaveBeenCalled();
    expect(onValueChange).toHaveBeenCalledWith('New value');
  });

  it('accepts placeholder prop', () => {
    render(<AutoResizingTextarea value="" onValueChange={vi.fn()} placeholder="Type here..." />);
    expect(screen.getByPlaceholderText('Type here...')).toBeTruthy();
  });

  it('accepts custom className', () => {
    const { container } = render(
      <AutoResizingTextarea value="" onValueChange={vi.fn()} className="custom-class" />
    );
    expect(container.querySelector('.custom-class')).toBeTruthy();
  });

  it('accepts disabled prop', () => {
    render(<AutoResizingTextarea value="" onValueChange={vi.fn()} disabled />);
    expect(screen.getByRole('textbox')).toBeDisabled();
  });

  it('renders empty value', () => {
    render(<AutoResizingTextarea value="" onValueChange={vi.fn()} />);
    expect(screen.getByRole('textbox')).toBeTruthy();
  });

  it('renders with multiline content', () => {
    render(<AutoResizingTextarea value="Line 1\nLine 2" onValueChange={vi.fn()} />);
    // Use regex to handle potential newline normalization differences
    expect(screen.getByDisplayValue(/Line 1[\s\S]*Line 2/)).toBeTruthy();
  });
});
