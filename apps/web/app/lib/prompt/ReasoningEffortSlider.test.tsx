import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'bun:test';

import '../../../../../tests/setup/dom';
import { ReasoningEffortSlider } from './ReasoningEffortSlider';

describe('ReasoningEffortSlider', () => {
  afterEach(() => cleanup());

  it('renders model-specific levels and reports the selected effort', () => {
    const onChange = vi.fn();
    render(
      <ReasoningEffortSlider
        levels={['low', 'medium', 'high', 'xhigh', 'max']}
        selectedEffort="xhigh"
        onChange={onChange}
      />
    );

    const slider = screen.getByRole('slider', { name: 'Reasoning effort' });
    expect(slider.getAttribute('aria-valuetext')).toBe('Extra high');
    fireEvent.input(slider, { target: { value: '4' } });
    expect(onChange).toHaveBeenCalledWith('max');
  });

  it('stays hidden for models without configurable effort', () => {
    const { container } = render(
      <ReasoningEffortSlider levels={[]} selectedEffort={null} onChange={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
