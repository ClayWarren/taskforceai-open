import { isRecord } from './guards';

export const extractError = (meta: unknown): Error | undefined => {
  if (!meta) {
    return undefined;
  }

  if (meta instanceof Error) {
    return meta;
  }

  if (isRecord(meta)) {
    const errorLike = meta['error'] ?? meta['cause'];
    if (errorLike instanceof Error) {
      return errorLike;
    }
  }

  return undefined;
};

export const normalizeMeta = (
  baseMeta: Record<string, unknown>,
  getLogMetadata: () => Record<string, unknown>,
  meta: unknown
): Record<string, unknown> | undefined => {
  const merged: Record<string, unknown> = {
    ...baseMeta,
    ...getLogMetadata(),
  };

  if (meta !== undefined && meta !== null) {
    if (meta instanceof Error) {
      merged['error'] = {
        name: meta.name,
        message: meta.message,
        stack: meta.stack,
      };
    } else if (isRecord(meta)) {
      Object.assign(merged, meta);
    } else {
      merged['detail'] = meta;
    }
  }

  return Object.keys(merged).length > 0 ? merged : undefined;
};
