import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'bun:test';

import '../../../../../../tests/setup/dom';

import { ReasoningEffortControl } from './ReasoningEffortControl';

describe('ReasoningEffortControl', () => {
  afterEach(() => cleanup());

  it('renders the desktop slider with model-specific levels', async () => {
    const onChange = vi.fn();
    render(
      <ReasoningEffortControl
        levels={['low', 'medium', 'high', 'xhigh', 'max']}
        selectedEffort="xhigh"
        onChange={onChange}
      />
    );

    const trigger = screen.getByRole('button', {
      name: 'Reasoning effort: Extra high',
    });
    await act(async () => {
      fireEvent.click(trigger);
      await Promise.resolve();
    });
    const slider = screen.getByRole('slider', { name: 'Reasoning effort' });
    expect(slider.getAttribute('aria-valuetext')).toBe('Extra high');

    await act(async () => {
      fireEvent.input(slider, { target: { value: '4' } });
    });
    expect(onChange).toHaveBeenCalledWith('max');

    await act(async () => {
      fireEvent.click(trigger);
      await Promise.resolve();
    });
  });

  it('stays hidden for models without configurable effort', () => {
    const { container } = render(
      <ReasoningEffortControl levels={[]} selectedEffort={null} onChange={vi.fn()} />
    );

    expect(container).toBeEmptyDOMElement();
  });
});
