'use client';

import React, { type ReactNode, createContext, useContext } from 'react';

import { useStreamingStore, type StreamingStoreState } from '../streaming/useStreamingStore';

export {
  sanitizeUrl,
  extractDomain,
  deriveTitleFromLine,
  extractSourcesFromText,
  mergeSources,
} from '@taskforceai/shared/utils/source-extraction';

const StreamingContext = createContext<StreamingStoreState | undefined>(undefined);

export const useStreaming = () => {
  const context = useContext(StreamingContext);
  if (!context) {
    throw new Error('useStreaming must be used within a StreamingProvider');
  }
  return context;
};

interface StreamingProviderProps {
  children: ReactNode;
}

export const StreamingProvider: React.FC<StreamingProviderProps> = ({ children }) => {
  const store = useStreamingStore();

  return <StreamingContext.Provider value={store}>{children}</StreamingContext.Provider>;
};
