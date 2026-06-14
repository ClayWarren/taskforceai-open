import { ok, err, type Result } from '@taskforceai/shared/result';
import {
  MAX_ATTACHMENTS,
  attachmentMetadataSchema,
} from '@taskforceai/shared/validation';

import * as FileSystem from '../utils/file-system';
import { createId } from '@taskforceai/shared/utils/id';

export { MAX_ATTACHMENTS };

export const ICON_BUTTON_SIZE = 46;
export const PROMPT_BUBBLE_MAX_WIDTH = 1200;
export const PROMPT_BUBBLE_GRADIENT = [
  'rgba(14,23,49,0.98)',
  'rgba(4,6,13,0.95)',
] as const;

export type AttachmentKind = 'file' | 'image';

export interface Attachment {
  id: string;
  name: string;
  uri: string;
  size: number;
  mimeType?: string | null;
  kind: AttachmentKind;
}

export const formatBytes = (bytes: number): string => {
  if (!bytes || bytes <= 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** power;
  return `${value.toFixed(value >= 10 || power === 0 ? 0 : 1)} ${units[power]}`;
};

export async function prepareAttachment(asset: {
  name: string;
  uri: string;
  size?: number | null;
  mimeType?: string | null;
  kind: AttachmentKind;
}): Promise<Result<Attachment>> {
  if (!asset.uri) {
    return err(new Error('Missing file URI'));
  }

  try {
    const info = await FileSystem.getInfoAsync(asset.uri);
    const resolvedSize =
      typeof asset.size === 'number' && asset.size > 0
        ? asset.size
        : info.exists && typeof info.size === 'number'
          ? info.size
          : 0;

    const validation = attachmentMetadataSchema.safeParse({
      name: asset.name,
      size: resolvedSize,
      mimeType: asset.mimeType,
    });

    if (!validation.success) {
      return err(new Error(validation.error.issues[0]?.message || 'Invalid file'));
    }

    return ok({
      id: createId('attachment'),
      name: asset.name,
      uri: asset.uri,
      size: resolvedSize,
      mimeType: asset.mimeType ?? 'application/octet-stream',
      kind: asset.kind,
    });
  } catch (error) {
    return err(error instanceof Error ? error : new Error('Failed to read file info'));
  }
}
