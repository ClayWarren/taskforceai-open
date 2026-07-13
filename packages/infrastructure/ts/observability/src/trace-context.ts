import { context, propagation } from '@opentelemetry/api';

export interface TraceContextCarrier {
  set(name: string, value: string): void;
}

export const injectActiveTraceContext = (carrier: TraceContextCarrier): void => {
  propagation.inject(context.active(), carrier, {
    set: (target, key, value) => target.set(key, value),
  });
};
