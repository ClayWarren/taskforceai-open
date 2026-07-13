import { render } from '@testing-library/react';
import { describe, it, expect } from 'bun:test';

import '../../../../tests/setup/dom';

import * as Icons from './icons';

describe('Icons', () => {
  it('renders SidebarIconPlus', () => {
    const { container } = render(<Icons.SidebarIconPlus />);
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('renders SidebarIconSearch', () => {
    const { container } = render(<Icons.SidebarIconSearch />);
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('renders SidebarIconSidebar', () => {
    const { container } = render(<Icons.SidebarIconSidebar />);
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('renders SidebarIconProfile', () => {
    const { container } = render(<Icons.SidebarIconProfile />);
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('renders MobileHamburgerIcon', () => {
    const { container } = render(<Icons.MobileHamburgerIcon />);
    expect(container.querySelector('svg')).toBeTruthy();
  });
});
