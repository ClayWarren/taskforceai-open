import { Component, type ErrorInfo, type ReactNode } from 'react';

import { logger } from '../../lib/logger';
import { StatusHeader } from './BrandMark';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class StatusErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    logger.error('StatusPage render error', {
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack ?? undefined,
    });
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-background">
          <StatusHeader />
          <main className="mx-auto max-w-4xl px-4 py-12">
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <p className="mb-2 text-lg font-semibold text-foreground">Something went wrong</p>
              <p className="mb-6 text-sm text-muted-foreground">
                The status page encountered an unexpected error.
              </p>
              <button
                type="button"
                onClick={() => this.setState({ hasError: false })}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
              >
                Try again
              </button>
            </div>
          </main>
        </div>
      );
    }

    return this.props.children;
  }
}
