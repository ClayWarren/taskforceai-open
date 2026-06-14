'use client';

import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

import { logger } from '../logger';
import ProfileModal from './ProfileModal';

interface ProfileModalContextValue {
  open: (_options?: { onOpen?: () => void }) => void;
  close: () => void;
}

const ProfileModalContext = createContext<ProfileModalContextValue | undefined>(undefined);

interface ProviderProps {
  children: React.ReactNode;
}

export const ProfileModalProvider: React.FC<ProviderProps> = ({ children }) => {
  const [isOpen, setIsOpen] = useState(false);
  const openCallbackRef = useRef<(() => void) | null>(null);

  const open = useCallback((options?: { onOpen?: () => void }) => {
    openCallbackRef.current = options?.onOpen ?? null;
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    openCallbackRef.current = null;
  }, []);

  const handleOpenChange = useCallback((openState: boolean) => {
    setIsOpen(openState);
    if (!openState) {
      openCallbackRef.current = null;
    }
  }, []);

  const handleModalOpen = useCallback(() => {
    if (openCallbackRef.current) {
      const cb = openCallbackRef.current;
      openCallbackRef.current = null;
      try {
        cb();
      } catch (error) {
        logger.error('[ProfileModal] onOpen callback threw', { error });
      }
    }
  }, []);
  const contextValue = useMemo(() => ({ open, close }), [open, close]);

  return (
    <ProfileModalContext.Provider value={contextValue}>
      {children}
      <ProfileModal open={isOpen} onOpenChange={handleOpenChange} onModalOpen={handleModalOpen} />
    </ProfileModalContext.Provider>
  );
};

export const useProfileModal = (): ProfileModalContextValue => {
  const context = useContext(ProfileModalContext);
  if (!context) {
    throw new Error('useProfileModal must be used within a ProfileModalProvider');
  }
  return context;
};

export const useOptionalProfileModal = (): ProfileModalContextValue | undefined => {
  return useContext(ProfileModalContext);
};
