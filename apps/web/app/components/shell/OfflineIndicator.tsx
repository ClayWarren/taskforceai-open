'use client';

import React, { useEffect, useRef, useState } from 'react';

const OfflineIndicator: React.FC = () => {
  const [isOnline, setIsOnline] = useState(true);
  const [showTransition, setShowTransition] = useState(false);
  const transitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') {
      return;
    }

    // Set initial state
    setIsOnline(navigator.onLine);

    const handleOnline = () => {
      setIsOnline(true);
      setShowTransition(true);
      if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = setTimeout(() => setShowTransition(false), 3000);
    };

    const handleOffline = () => {
      setIsOnline(false);
      setShowTransition(true);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current);
    };
  }, []);

  // Don't show anything if online and not transitioning
  if (isOnline && !showTransition) {
    return null;
  }

  return (
    <div
      className={`offline-indicator fixed top-0 right-0 left-0 z-50 px-4 py-3 text-center text-sm font-medium transition-all duration-300 ${
        isOnline ? 'bg-green-600 text-white' : 'bg-yellow-600 text-white'
      }`}
      role="status"
      aria-live="polite"
    >
      {isOnline ? (
        <>
          <svg
            className="mr-2 inline-block h-4 w-4"
            fill="currentColor"
            viewBox="0 0 20 20"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              fillRule="evenodd"
              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
              clipRule="evenodd"
            />
          </svg>
          Back online
        </>
      ) : (
        <>
          <svg
            className="mr-2 inline-block h-4 w-4"
            fill="currentColor"
            viewBox="0 0 20 20"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              fillRule="evenodd"
              d="M13.477 14.89A6 6 0 015.11 6.524l8.367 8.368zm1.414-1.414L6.524 5.11a6 6 0 018.367 8.367zM18 10a8 8 0 11-16 0 8 8 0 0116 0z"
              clipRule="evenodd"
            />
          </svg>
          You&apos;re offline. Messages will sync when reconnected.
        </>
      )}
    </div>
  );
};

export default OfflineIndicator;
