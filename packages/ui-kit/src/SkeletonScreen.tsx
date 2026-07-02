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

export const ConversationListSkeleton: React.FC = () => (
  <div className="space-y-4 p-4" role="status" aria-label="Loading conversations">
    {[...Array<undefined>(5)].map((_, i) => (
      <div key={i} className="space-y-2">
        <Skeleton width="60%" height="12px" />
        <Skeleton width="90%" height="16px" />
        <Skeleton width="75%" height="14px" />
      </div>
    ))}
    <span className="sr-only">Loading conversations...</span>
  </div>
);

export const MessageSkeleton: React.FC = () => (
  <div className="space-y-4 p-4" role="status" aria-label="Loading message">
    <div className="space-y-2">
      <Skeleton width="40%" height="16px" />
      <Skeleton width="95%" height="20px" />
      <Skeleton width="88%" height="20px" />
      <Skeleton width="92%" height="20px" />
    </div>
    <span className="sr-only">Loading message...</span>
  </div>
);

export const StreamingMessageSkeleton: React.FC = () => (
  <div className="flex items-center space-x-2 p-4" role="status" aria-label="Generating response">
    <div className="flex space-x-1">
      <div className="h-2 w-2 animate-pulse rounded-full bg-blue-500" />
      <div
        className="h-2 w-2 animate-pulse rounded-full bg-blue-500"
        style={{ animationDelay: '150ms' }}
      />
      <div
        className="h-2 w-2 animate-pulse rounded-full bg-blue-500"
        style={{ animationDelay: '300ms' }}
      />
    </div>
    <span className="text-gray-500 dark:text-gray-400">AI is thinking...</span>
    <span className="sr-only">Generating response...</span>
  </div>
);
