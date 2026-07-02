const storageFormatter = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
});

export function formatStorageBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1000 && unitIndex < units.length - 1) {
    value /= 1000;
    unitIndex += 1;
  }

  return `${storageFormatter.format(value)} ${units[unitIndex]}`;
}

export function formatStorageItemCount(
  categoryId: string,
  count: number,
  options: { pendingUploadLabel?: string } = {}
): string {
  if (categoryId === 'pending_uploads' && options.pendingUploadLabel) {
    return options.pendingUploadLabel;
  }
  if (count === 1) {
    return categoryId === 'images' ? '1 image' : '1 file';
  }
  if (categoryId === 'images') {
    return `${count} images`;
  }
  return `${count} files`;
}
