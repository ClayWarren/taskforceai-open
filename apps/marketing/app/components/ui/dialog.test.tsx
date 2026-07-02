import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'bun:test';

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogTitle,
  DialogTrigger,
} from './dialog';

describe('Dialog', () => {
  it('renders trigger', () => {
    render(
      <Dialog>
        <DialogTrigger>Open Dialog</DialogTrigger>
      </Dialog>
    );

    expect(screen.getByText('Open Dialog')).toBeTruthy();
  });

  it('opens content when trigger is clicked', async () => {
    render(
      <Dialog>
        <DialogTrigger>Open</DialogTrigger>
        <DialogContent>
          <DialogTitle>Dialog Title</DialogTitle>
          <DialogDescription>Dialog Description</DialogDescription>
          <div>Dialog Body</div>
        </DialogContent>
      </Dialog>
    );

    expect(screen.queryByText('Dialog Body')).toBeNull();

    fireEvent.click(screen.getByText('Open'));

    await waitFor(() => {
      expect(screen.getByText('Dialog Body')).toBeTruthy();
      expect(screen.getByText('Dialog Title')).toBeTruthy();
      expect(screen.getByText('Dialog Description')).toBeTruthy();
    });
  });

  it('applies custom classes to content', async () => {
    render(
      <Dialog defaultOpen>
        <DialogContent className="custom-dialog-class" data-testid="content">
          <DialogTitle>Dialog title</DialogTitle>
          <DialogDescription>Dialog description</DialogDescription>
          Content
        </DialogContent>
      </Dialog>
    );

    await waitFor(() => {
      const content = screen.getByTestId('content');
      expect(content.className).toContain('custom-dialog-class');
      expect(content.className).toContain('fixed');
      // z-index is applied via inline style, not a Tailwind class
      expect(content.style.zIndex).toBeTruthy();
    });
  });

  it('renders overlay', async () => {
    render(
      <Dialog defaultOpen>
        <DialogOverlay data-testid="overlay" />
        <DialogContent>
          <DialogTitle>Dialog title</DialogTitle>
          <DialogDescription>Dialog description</DialogDescription>
          Content
        </DialogContent>
      </Dialog>
    );

    await waitFor(() => {
      expect(screen.getByTestId('overlay')).toBeTruthy();
    });
  });

  it('renders header and footer components', async () => {
    render(
      <Dialog defaultOpen>
        <DialogContent>
          <DialogTitle>Dialog title</DialogTitle>
          <DialogDescription>Dialog description</DialogDescription>
          <DialogHeader data-testid="header">Header</DialogHeader>
          <DialogFooter data-testid="footer">Footer</DialogFooter>
        </DialogContent>
      </Dialog>
    );

    await waitFor(() => {
      const header = screen.getByTestId('header');
      const footer = screen.getByTestId('footer');

      expect(header.className).toContain('flex');
      expect(header.className).toContain('flex-col');
      expect(footer.className).toContain('flex');
      expect(footer.className).toContain('flex-col-reverse');
    });
  });

  it('renders close button inside content', async () => {
    render(
      <Dialog defaultOpen>
        <DialogContent>
          <DialogTitle>Dialog title</DialogTitle>
          <DialogDescription>Dialog description</DialogDescription>
          Content
        </DialogContent>
      </Dialog>
    );

    await waitFor(() => {
      // Radix/Dialog includes a close button with sr-only "Close" text
      expect(screen.getByText('Close')).toBeTruthy();
    });
  });

  it('DialogClose renders as a button', async () => {
    render(
      <Dialog defaultOpen>
        <DialogContent>
          <DialogTitle>Dialog title</DialogTitle>
          <DialogDescription>Dialog description</DialogDescription>
          <DialogClose>Custom Close</DialogClose>
        </DialogContent>
      </Dialog>
    );

    await waitFor(() => {
      expect(screen.getByText('Custom Close')).toBeTruthy();
    });
  });
});
