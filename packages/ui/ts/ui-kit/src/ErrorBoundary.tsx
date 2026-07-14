'use client';

import React, { Component, ReactNode } from 'react';
import { getAuthLogger } from '@taskforceai/api-client/auth/logger';

import { reloadPage } from '@taskforceai/browser-runtime/browser-actions';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

const logger = getAuthLogger();

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    logger.error('React Error Boundary caught an error', {
      error,
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
    });
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
          <div className="max-w-md rounded-lg bg-white p-8 shadow-lg dark:bg-gray-800">
            <h1 className="mb-4 text-2xl font-bold text-red-600 dark:text-red-400">
              Something went wrong
            </h1>
            <p className="mb-4 text-gray-700 dark:text-gray-300">
              {this.state.error?.message || 'An unexpected error occurred'}
            </p>
            <button
              type="button"
              onClick={() => {
                const result = reloadPage();
                if (!result.ok) {
                  logger.error('Failed to reload after error boundary', { error: result.error });
                }
              }}
              className="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
