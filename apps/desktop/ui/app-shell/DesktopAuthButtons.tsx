'use client';

import clsx from 'clsx';
import React from 'react';

import { SIGN_IN_BUTTON_CLASSES } from './desktop-auth-buttons-styles';

interface DesktopAuthButtonsProps {
  onSignIn: () => void;
}

export const DesktopAuthButtons: React.FC<DesktopAuthButtonsProps> = ({ onSignIn }) => (
  <div className="desktop-auth-buttons flex gap-3" role="presentation">
    <button type="button" className={clsx(SIGN_IN_BUTTON_CLASSES)} onClick={onSignIn}>
      Sign in
    </button>
  </div>
);
