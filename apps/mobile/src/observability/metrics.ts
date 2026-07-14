import * as Sentry from '@sentry/react-native';
import type { MetricsCollector } from '@taskforceai/api-client';
import { mobileLogger } from '../logger';

/**
 * MobileMetrics - A MetricsCollector implementation for the mobile app.
 * 
 * Since @sentry/react-native v7.x does not have a dedicated metrics API,
 * we use breadcrumbs for counters and transactions/spans for timers.
 */
class MobileMetrics implements MetricsCollector {
  private static instance: MobileMetrics;

  private constructor() {}

  static getInstance(): MobileMetrics {
    if (!MobileMetrics.instance) {
      MobileMetrics.instance = new MobileMetrics();
    }
    return MobileMetrics.instance;
  }

  /**
   * Increment a counter by adding a Sentry breadcrumb.
   */
  incrementCounter(name: string, tags?: Record<string, unknown>): void {
    if (__DEV__) {
      mobileLogger.debug(`[Metric] Counter: ${name}`, tags);
    }
    
    Sentry.addBreadcrumb({
      category: 'metrics.counter',
      message: name,
      data: tags,
      level: 'info',
    });
  }

  /**
   * Start a timer and return a function to stop it.
   * On mobile, we use Sentry spans if a transaction is active, 
   * or a simple log if not.
   */
  startTimer(name: string, tags?: Record<string, unknown>): () => void {
    const startTime = Date.now();

    if (__DEV__) {
      mobileLogger.debug(`[Metric] Timer Start: ${name}`, tags);
    }

    return () => {
      const duration = Date.now() - startTime;

      if (__DEV__) {
        mobileLogger.debug(`[Metric] Timer End: ${name} (${duration}ms)`, tags);
      }

      Sentry.addBreadcrumb({
        category: 'metrics.timer',
        message: name,
        data: {
          ...tags,
          duration_ms: duration,
        },
        level: 'info',
      });
    };
  }
}

export const mobileMetrics = MobileMetrics.getInstance();
