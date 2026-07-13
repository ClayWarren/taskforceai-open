import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, mock } from 'bun:test';
import { PromptAttachments } from './PromptAttachments';
import { createLargePasteAttachment } from './largePasteAttachment';

describe('PromptAttachments', () => {
  const mockOnRemove = mock();
  const mockOnShowInTextField = mock();
  const mockFiles = [
    new File([''], 'test1.txt', { type: 'text/plain' }),
    new File([''], 'image.png', { type: 'image/png' }),
  ];

  it('renders nothing when no files are provided', () => {
    const { container } = render(
      <PromptAttachments
        files={[]}
        onRemove={mockOnRemove}
        onShowInTextField={mockOnShowInTextField}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders list of files', () => {
    render(
      <PromptAttachments
        files={mockFiles}
        onRemove={mockOnRemove}
        onShowInTextField={mockOnShowInTextField}
      />
    );

    expect(screen.getByText('test1.txt')).toBeTruthy();
    expect(screen.getByText('image.png')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove test1.txt' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove image.png' })).toBeTruthy();
  });

  it('calls onRemove when remove button is clicked', () => {
    render(
      <PromptAttachments
        files={mockFiles}
        onRemove={mockOnRemove}
        onShowInTextField={mockOnShowInTextField}
      />
    );

    const removeButtons = screen.getAllByTitle(/Remove/);
    expect(removeButtons).toHaveLength(2);

    const firstButton = removeButtons[0];
    const secondButton = removeButtons[1];
    if (!firstButton || !secondButton) {
      throw new Error('Expected two remove buttons');
    }
    fireEvent.click(firstButton);
    expect(mockOnRemove).toHaveBeenCalledWith(0);

    fireEvent.click(secondButton);
    expect(mockOnRemove).toHaveBeenCalledWith(1);
  });

  it('offers to restore generated paste attachments to the text field', () => {
    render(
      <PromptAttachments
        files={[createLargePasteAttachment('large paste')]}
        onRemove={mockOnRemove}
        onShowInTextField={mockOnShowInTextField}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Show in text field' }));

    expect(mockOnShowInTextField).toHaveBeenCalledWith(0);
  });
});
