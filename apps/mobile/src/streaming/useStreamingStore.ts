import { createStreamingStore } from '@taskforceai/react-core';
import { createMobileStreamingAdapter } from './mobile-adapter';
import { AppState, type AppStateStatus } from 'react-native';
import { useEffect } from 'react';

export * from '@taskforceai/react-core';

export const useStreamingStore = createStreamingStore(createMobileStreamingAdapter());

// Auto-abort streams when the app goes into the background
export function useStreamingAutoAbort() {
    useEffect(() => {
        if (!AppState?.addEventListener) return;
        const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
            if (nextAppState.match(/inactive|background/)) {
                const { isStreaming, stopStreaming } = useStreamingStore.getState();
                if (isStreaming) {
                    stopStreaming();
                }
            }
        });
        return () => subscription.remove();
    }, []);
}
