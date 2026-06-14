import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'bun:test';
import '../../../tests/setup/dom';

import { MAX_ATTACHMENTS } from '@taskforceai/shared/validation';

import { useFileAttachments, type BaseAttachment } from './useFileAttachments';

interface MockAttachment extends BaseAttachment {
  type?: string;
}

const createAttachment = (index: number): MockAttachment => ({
  name: `attachment-${index}.txt`,
  size: 1024,
  mimeType: 'text/plain',
  type: 'text/plain',
});

describe('useFileAttachments', () => {
  it('enforces MAX_ATTACHMENTS across rapid sequential addFile calls', () => {
    const { result } = renderHook(() => useFileAttachments<MockAttachment>());

    act(() => {
      result.current.addFiles(
        Array.from({ length: MAX_ATTACHMENTS - 1 }, (_, index) => createAttachment(index + 1))
      );
    });
    expect(result.current.files).toHaveLength(MAX_ATTACHMENTS - 1);

    act(() => {
      result.current.addFile(createAttachment(MAX_ATTACHMENTS));
      result.current.addFile(createAttachment(MAX_ATTACHMENTS + 1));
    });

    expect(result.current.files).toHaveLength(MAX_ATTACHMENTS);
    expect(result.current.error).toBe(`You can only attach up to ${MAX_ATTACHMENTS} files.`);
  });

  it('adds, removes, clears, and triggers file input interactions', () => {
    const { result } = renderHook(() => useFileAttachments<MockAttachment>());
    const input = document.createElement('input');
    const click = vi.spyOn(input, 'click').mockImplementation(() => undefined);
    result.current.fileInputRef.current = input;

    act(() => {
      result.current.addFile(createAttachment(1));
      result.current.addFiles([createAttachment(2)]);
    });

    expect(result.current.files.map((file) => file.name)).toEqual([
      'attachment-1.txt',
      'attachment-2.txt',
    ]);

    act(() => {
      result.current.removeFile(0);
    });

    expect(result.current.files.map((file) => file.name)).toEqual(['attachment-2.txt']);

    act(() => {
      result.current.setError('manual error');
      input.value = 'selected-file';
      result.current.triggerFileDialog();
      result.current.clearFiles();
    });

    expect(click).toHaveBeenCalledTimes(1);
    expect(result.current.files).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(input.value).toBe('');
  });

  it('handles input change, resets the target value, and rejects invalid metadata', () => {
    const { result } = renderHook(() => useFileAttachments<MockAttachment>());
    const firstFile = createAttachment(1);
    const secondFile = { name: '', size: -1, mimeType: '' };
    const input = document.createElement('input');

    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [firstFile],
    });
    input.value = 'selected-file';

    act(() => {
      result.current.handleFileChange({
        target: input,
      } as unknown as React.ChangeEvent<HTMLInputElement>);
    });

    expect(result.current.files).toEqual([firstFile]);
    expect(input.value).toBe('');

    act(() => {
      result.current.addFile(secondFile);
    });

    expect(result.current.files).toEqual([firstFile]);
    expect(result.current.error).toBeTruthy();
  });

  it('adds files from drag and drop interactions', () => {
    const { result } = renderHook(() => useFileAttachments<MockAttachment>());
    const droppedFile = createAttachment(1);
    const currentTarget = document.createElement('form');

    act(() => {
      result.current.handleDragOver({
        preventDefault: vi.fn(),
        currentTarget,
        dataTransfer: {
          types: ['Files'],
          dropEffect: 'none',
          files: [],
        },
      } as unknown as React.DragEvent<HTMLElement>);
    });

    expect(result.current.isDraggingFiles).toBe(true);

    act(() => {
      result.current.handleDrop({
        preventDefault: vi.fn(),
        currentTarget,
        dataTransfer: {
          types: ['Files'],
          files: [droppedFile],
        },
      } as unknown as React.DragEvent<HTMLElement>);
    });

    expect(result.current.files).toEqual([droppedFile]);
    expect(result.current.isDraggingFiles).toBe(false);
  });

  it('keeps the drag state while moving within the drop target and clears it for empty drops', () => {
    const { result } = renderHook(() => useFileAttachments<MockAttachment>());
    const currentTarget = document.createElement('form');
    const child = document.createElement('button');
    currentTarget.appendChild(child);
    const preventDefault = vi.fn();

    act(() => {
      result.current.handleDragOver({
        preventDefault,
        currentTarget,
        dataTransfer: {
          types: ['Files'],
          dropEffect: 'none',
          files: [],
        },
      } as unknown as React.DragEvent<HTMLElement>);
    });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(result.current.isDraggingFiles).toBe(true);

    act(() => {
      result.current.handleDragLeave({
        currentTarget,
        relatedTarget: child,
      } as unknown as React.DragEvent<HTMLElement>);
    });

    expect(result.current.isDraggingFiles).toBe(true);

    act(() => {
      result.current.handleDrop({
        preventDefault: vi.fn(),
        currentTarget,
        dataTransfer: {
          types: ['Files'],
          files: [],
        },
      } as unknown as React.DragEvent<HTMLElement>);
    });

    expect(result.current.files).toEqual([]);
    expect(result.current.isDraggingFiles).toBe(false);
  });

  it('reports oversized batches when the default reject strategy rejects them', () => {
    const onLimitExceeded = vi.fn();
    const { result } = renderHook(() =>
      useFileAttachments<MockAttachment>({
        onLimitExceeded,
      })
    );

    act(() => {
      result.current.addFiles(
        Array.from({ length: MAX_ATTACHMENTS + 1 }, (_, index) => createAttachment(index))
      );
    });

    expect(result.current.files).toEqual([]);
    expect(result.current.error).toBe(`You can only attach up to ${MAX_ATTACHMENTS} files.`);
    expect(onLimitExceeded).toHaveBeenCalledWith({
      availableSlots: MAX_ATTACHMENTS,
      totalLimit: MAX_ATTACHMENTS,
    });
  });

  it('can dedupe and partially accept attachments for native pickers', () => {
    const onDuplicate = vi.fn();
    const onLimitExceeded = vi.fn();
    const { result } = renderHook(() =>
      useFileAttachments<MockAttachment>({
        getKey: (file) => file.name,
        limitStrategy: 'truncate',
        onDuplicate,
        onLimitExceeded,
      })
    );

    act(() => {
      result.current.addFiles(
        Array.from({ length: MAX_ATTACHMENTS - 1 }, (_, index) => createAttachment(index))
      );
      result.current.addFiles([
        createAttachment(0),
        createAttachment(MAX_ATTACHMENTS),
        createAttachment(MAX_ATTACHMENTS + 1),
      ]);
    });

    expect(result.current.files).toHaveLength(MAX_ATTACHMENTS);
    expect(onDuplicate).toHaveBeenCalled();
    expect(onLimitExceeded).toHaveBeenCalledWith({
      availableSlots: 1,
      totalLimit: MAX_ATTACHMENTS,
    });
  });
});
