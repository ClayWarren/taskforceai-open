'use client';

import type { ImgHTMLAttributes } from 'react';

/**
 * Image abstraction
 *
 * Now uses standard <img> element with modern browser native lazy loading.
 */
export interface ImageProps extends ImgHTMLAttributes<HTMLImageElement> {
  fill?: boolean;
  priority?: boolean;
  sizes?: string;
}

export function Image({ fill, priority, sizes, className, style, ...props }: ImageProps) {
  // Handle fill mode - absolute positioning to fill parent
  const fillStyles = fill
    ? {
        position: 'absolute' as const,
        inset: 0,
        width: '100%',
        height: '100%',
        objectFit: 'cover' as const,
      }
    : {};

  return (
    <img
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      sizes={sizes}
      className={className}
      style={{ ...fillStyles, ...style }}
      {...props}
    />
  );
}
