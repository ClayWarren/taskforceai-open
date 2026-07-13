import React from 'react';

interface SkeletonProps {
  width?: string;
  height?: string;
  className?: string;
}

export const Skeleton: React.FC<SkeletonProps> = ({
  width = '100%',
  height = '20px',
  className = '',
}) => (
  <div
    className={`animate-pulse rounded bg-gray-300 dark:bg-gray-700 ${className}`}
    style={{ width, height }}
    aria-hidden="true"
  />
);
