import { createStreamingStore } from '@taskforceai/react-core';
import { createWebStreamingAdapter } from './web-adapter';

export * from '@taskforceai/react-core';

export const useStreamingStore = createStreamingStore(createWebStreamingAdapter());
