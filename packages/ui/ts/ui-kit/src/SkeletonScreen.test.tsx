import { render } from '@testing-library/react';
import { describe, expect, it } from 'bun:test';
import '../../../../../tests/setup/dom';

import { Skeleton } from './SkeletonScreen';

describe('SkeletonScreen', () => {
  it('renders the base skeleton with caller-provided dimensions and class names', () => {
    const { container } = render(<Skeleton width="50%" height="10px" className="custom" />);
    const element = container.firstElementChild;

    expect(element).toHaveAttribute('aria-hidden', 'true');
    expect(element).toHaveClass('custom');
    expect((element as HTMLElement).style.width).toBe('50%');
    expect((element as HTMLElement).style.height).toBe('10px');
  });
});
