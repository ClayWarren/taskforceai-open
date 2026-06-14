import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'bun:test';

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from './dropdown-menu';

describe('DropdownMenu', () => {
  it('renders trigger', () => {
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Open Menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Item</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );

    expect(screen.getByText('Open Menu')).toBeTruthy();
  });

  it('opens menu on click', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>My Menu</DropdownMenuLabel>
          <DropdownMenuItem>Item 1</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem>Item 2</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );

    expect(screen.queryByText('Item 1')).toBeNull();

    await user.click(screen.getByText('Open'));

    await waitFor(() => {
      expect(screen.getByText('My Menu')).toBeTruthy();
      expect(screen.getByText('Item 1')).toBeTruthy();
      expect(screen.getByText('Item 2')).toBeTruthy();
    });
  });

  it('renders checkbox items', async () => {
    render(
      <DropdownMenu defaultOpen>
        <DropdownMenuContent>
          <DropdownMenuCheckboxItem checked>Checked Item</DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem checked={false}>Unchecked Item</DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );

    await waitFor(() => {
      expect(screen.getByText('Checked Item')).toBeTruthy();
      expect(screen.getByText('Unchecked Item')).toBeTruthy();
      const items = screen.getAllByRole('menuitemcheckbox');
      expect(items).toHaveLength(2);
      const [checkedItem, uncheckedItem] = items;
      if (!checkedItem || !uncheckedItem) {
        throw new Error('Expected two checkbox items');
      }
      expect(checkedItem.getAttribute('aria-checked')).toBe('true');
      expect(uncheckedItem.getAttribute('aria-checked')).toBe('false');
    });
  });

  it('renders radio items', async () => {
    render(
      <DropdownMenu defaultOpen>
        <DropdownMenuContent>
          <DropdownMenuRadioGroup value="item1">
            <DropdownMenuRadioItem value="item1">Item 1</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="item2">Item 2</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    );

    await waitFor(() => {
      const items = screen.getAllByRole('menuitemradio');
      expect(items).toHaveLength(2);
      const [firstItem, secondItem] = items;
      if (!firstItem || !secondItem) {
        throw new Error('Expected two radio items');
      }
      expect(firstItem.getAttribute('aria-checked')).toBe('true');
      expect(secondItem.getAttribute('aria-checked')).toBe('false');
    });
  });

  it('renders submenus', async () => {
    render(
      <DropdownMenu defaultOpen>
        <DropdownMenuContent>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Submenu</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem>Sub Item</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>
    );

    await waitFor(() => {
      expect(screen.getByText('Submenu')).toBeTruthy();
    });
  });

  it('renders shortcut', async () => {
    render(
      <DropdownMenu defaultOpen>
        <DropdownMenuContent>
          <DropdownMenuItem>
            Item
            <DropdownMenuShortcut>⌘+I</DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );

    await waitFor(() => {
      expect(screen.getByText('⌘+I')).toBeTruthy();
    });
  });

  it('applies custom classes to content', async () => {
    render(
      <DropdownMenu defaultOpen>
        <DropdownMenuContent className="custom-menu" data-testid="menu-content">
          <DropdownMenuItem>Item</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );

    await waitFor(() => {
      const content = screen.getByTestId('menu-content');
      expect(content.className).toContain('custom-menu');
      expect(content.className).toContain('z-50');
      expect(content.className).toContain('bg-popover');
    });
  });

  it('support inset on props', async () => {
    render(
      <DropdownMenu defaultOpen>
        <DropdownMenuContent>
          <DropdownMenuLabel inset data-testid="label">
            Label
          </DropdownMenuLabel>
          <DropdownMenuItem inset data-testid="item">
            Item
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );

    await waitFor(() => {
      expect(screen.getByTestId('label').className).toContain('pl-8');
      expect(screen.getByTestId('item').className).toContain('pl-8');
    });
  });
});
