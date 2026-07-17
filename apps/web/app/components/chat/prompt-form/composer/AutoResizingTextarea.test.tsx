import '../../../../../../../tests/setup/dom';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'bun:test';

import { AutoResizingTextarea } from './AutoResizingTextarea';

describe('AutoResizingTextarea', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders with value', () => {
    render(<AutoResizingTextarea value="Hello" onValueChange={vi.fn()} />);
    expect(screen.getByDisplayValue('Hello')).toBeTruthy();
  });

  it('handles onChange from props', async () => {
    const onChange = vi.fn();
    const ControlledTextarea = () => {
      const [value, setValue] = useState('');
      return <AutoResizingTextarea value={value} onValueChange={setValue} onChange={onChange} />;
    };

    render(<ControlledTextarea />);
    const user = userEvent.setup({ document: globalThis.document });

    await user.type(screen.getByRole('textbox'), 'New value');

    expect(onChange).toHaveBeenCalled();
    expect(screen.getByDisplayValue('New value')).toBeTruthy();
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

  it('resizes to the clamped scroll height and toggles overflow', () => {
    const { rerender } = render(
      <AutoResizingTextarea value="short" onValueChange={vi.fn()} minHeight={40} maxHeight={80} />
    );
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;

    Object.defineProperty(textarea, 'scrollHeight', {
      configurable: true,
      value: 24,
    });
    rerender(
      <AutoResizingTextarea
        value="short update"
        onValueChange={vi.fn()}
        minHeight={40}
        maxHeight={80}
      />
    );

    expect(textarea.style.height).toBe('40px');
    expect(textarea.style.overflowY).toBe('hidden');

    Object.defineProperty(textarea, 'scrollHeight', {
      configurable: true,
      value: 120,
    });
    rerender(
      <AutoResizingTextarea
        value={'long update'}
        onValueChange={vi.fn()}
        minHeight={40}
        maxHeight={80}
      />
    );

    expect(textarea.style.height).toBe('80px');
    expect(textarea.style.overflowY).toBe('auto');
  });

  it('resizes on window resize and removes the listener on unmount', () => {
    const addEventListener = vi.spyOn(window, 'addEventListener');
    const removeEventListener = vi.spyOn(window, 'removeEventListener');
    const { unmount } = render(
      <AutoResizingTextarea
        value="resizable"
        onValueChange={vi.fn()}
        minHeight={40}
        maxHeight={90}
      />
    );
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;

    Object.defineProperty(textarea, 'scrollHeight', {
      configurable: true,
      value: 72,
    });
    fireEvent(window, new Event('resize'));

    expect(textarea.style.height).toBe('72px');
    expect(textarea.style.overflowY).toBe('hidden');
    expect(addEventListener).toHaveBeenCalledWith('resize', expect.any(Function));

    unmount();

    expect(removeEventListener).toHaveBeenCalledWith('resize', expect.any(Function));
  });

  it('submits on bare Enter and preserves Shift+Enter for multiline input', async () => {
    const onEnterPress = vi.fn();
    const onKeyDown = vi.fn();
    render(
      <AutoResizingTextarea
        value=""
        onValueChange={vi.fn()}
        onEnterPress={onEnterPress}
        onKeyDown={onKeyDown}
      />
    );
    const user = userEvent.setup({ document: globalThis.document });

    await user.click(screen.getByRole('textbox'));
    await user.keyboard('{Enter}');
    await user.keyboard('{Shift>}{Enter}{/Shift}');

    expect(onKeyDown.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(onEnterPress).toHaveBeenCalledTimes(1);
  });

  it('does not submit Enter when the caller already prevented the key event', async () => {
    const onEnterPress = vi.fn();
    render(
      <AutoResizingTextarea
        value=""
        onValueChange={vi.fn()}
        onEnterPress={onEnterPress}
        onKeyDown={(event) => event.preventDefault()}
      />
    );
    const user = userEvent.setup({ document: globalThis.document });

    await user.click(screen.getByRole('textbox'));
    await user.keyboard('{Enter}');

    expect(onEnterPress).not.toHaveBeenCalled();
  });

  it('forwards refs and preserves caller styles', () => {
    const ref = createRef<HTMLTextAreaElement>();

    render(
      <AutoResizingTextarea ref={ref} value="" onValueChange={vi.fn()} style={{ color: 'red' }} />
    );

    expect(ref.current).toBe(screen.getByRole('textbox'));
    expect(screen.getByRole('textbox').getAttribute('style')).toContain('text-align: left');
    expect(screen.getByRole('textbox').getAttribute('style')).toContain('color: red');
  });
});
