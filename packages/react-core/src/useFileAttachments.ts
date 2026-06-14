import { useCallback, useRef, useState } from 'react';
import { MAX_ATTACHMENTS, attachmentMetadataSchema } from '@taskforceai/shared/validation';

export interface BaseAttachment {
  name: string;
  size: number;
  mimeType?: string | null;
}

export function useFileAttachments<T extends BaseAttachment = File>(
  options: {
    getKey?: (file: T) => string;
    limitStrategy?: 'reject' | 'truncate';
    onDuplicate?: () => void;
    onLimitExceeded?: (_input: { availableSlots: number; totalLimit: number }) => void;
  } = {}
) {
  const { getKey, limitStrategy = 'reject', onDuplicate, onLimitExceeded } = options;
  const [files, setFiles] = useState<T[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);

  // HTML-specific ref, used only on web
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const validateFiles = useCallback((newFiles: T[], currentFiles: T[]) => {
    if (currentFiles.length + newFiles.length > MAX_ATTACHMENTS) {
      return `You can only attach up to ${MAX_ATTACHMENTS} files.`;
    }

    for (const file of newFiles) {
      const result = attachmentMetadataSchema.safeParse({
        name: file.name,
        size: file.size,
        mimeType: file.mimeType || (file as any).type,
      });

      if (!result.success) {
        return result.error.issues[0]?.message || 'Invalid file';
      }
    }

    return null;
  }, []);

  const appendFiles = useCallback(
    (newFiles: T[]) => {
      setFiles((previousFiles) => {
        let filesToValidate = newFiles;
        if (getKey) {
          const existingKeys = new Set(previousFiles.map(getKey));
          filesToValidate = newFiles.filter((file) => !existingKeys.has(getKey(file)));
        }

        if (filesToValidate.length < newFiles.length) {
          onDuplicate?.();
          if (filesToValidate.length === 0) {
            return previousFiles;
          }
        }

        const availableSlots = MAX_ATTACHMENTS - previousFiles.length;
        if (availableSlots <= 0) {
          const message = `You can only attach up to ${MAX_ATTACHMENTS} files.`;
          setError(message);
          onLimitExceeded?.({ availableSlots, totalLimit: MAX_ATTACHMENTS });
          return previousFiles;
        }

        const exceedsLimit = filesToValidate.length > availableSlots;
        const acceptedFiles =
          limitStrategy === 'truncate' ? filesToValidate.slice(0, availableSlots) : filesToValidate;

        if (exceedsLimit) {
          onLimitExceeded?.({ availableSlots, totalLimit: MAX_ATTACHMENTS });
        }

        const validationError = validateFiles(acceptedFiles, previousFiles);
        if (validationError) {
          setError(validationError);
          return previousFiles;
        }
        setError(null);
        return [...previousFiles, ...acceptedFiles];
      });
    },
    [getKey, limitStrategy, onDuplicate, onLimitExceeded, validateFiles]
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selectedFiles = Array.from(e.target.files || []) as unknown as T[];
      if (selectedFiles.length > 0) {
        appendFiles(selectedFiles);

        // Reset the input value so the same file can be selected again
        if (e.target) {
          e.target.value = '';
        }
      }
    },
    [appendFiles]
  );

  const handleDragOver = useCallback((event: React.DragEvent<HTMLElement>) => {
    if (Array.from(event.dataTransfer.types).includes('Files')) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      setIsDraggingFiles(true);
    }
  }, []);

  const handleDragLeave = useCallback((event: React.DragEvent<HTMLElement>) => {
    const currentTarget = event.currentTarget;
    const relatedTarget = event.relatedTarget;
    if (relatedTarget instanceof Node && currentTarget.contains(relatedTarget)) {
      return;
    }
    setIsDraggingFiles(false);
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      const droppedFiles = Array.from(event.dataTransfer.files || []) as unknown as T[];
      if (Array.from(event.dataTransfer.types).includes('Files')) {
        event.preventDefault();
      }
      if (droppedFiles.length === 0) {
        setIsDraggingFiles(false);
        return;
      }

      setIsDraggingFiles(false);
      appendFiles(droppedFiles);
    },
    [appendFiles]
  );

  const addFile = useCallback(
    (file: T) => {
      appendFiles([file]);
    },
    [appendFiles]
  );

  const addFiles = useCallback(
    (newFiles: T[]) => {
      appendFiles(newFiles);
    },
    [appendFiles]
  );

  const removeFile = useCallback((indexToRemove: number) => {
    setFiles((prev) => prev.filter((_, index) => index !== indexToRemove));
    setError(null);
  }, []);

  const clearFiles = useCallback(() => {
    setFiles([]);
    setError(null);
    setIsDraggingFiles(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const triggerFileDialog = useCallback(() => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  }, []);

  return {
    files,
    setFiles,
    error,
    setError,
    isDraggingFiles,
    fileInputRef,
    handleFileChange,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    addFile,
    addFiles,
    removeFile,
    clearFiles,
    triggerFileDialog,
  };
}
