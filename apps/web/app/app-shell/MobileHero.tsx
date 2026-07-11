'use client';

import React from 'react';

import { Image } from '../components/shared/Image';
import { MobileHamburgerIcon } from './icons';
import {
  MOBILE_HERO_AUTH_BUTTON_CLASSES,
  MOBILE_HERO_CENTER_LOGO_CLASSES,
  MOBILE_HERO_HAMBURGER_CLASSES,
} from './mobile-hero-styles';

interface MobileHeroProps {
  isAuthenticated: boolean;
  onHamburgerClick: () => void;
  onSignIn: () => void;
}

export const MobileHero: React.FC<MobileHeroProps> = ({
  isAuthenticated,
  onHamburgerClick,
  onSignIn,
}) => (
  <section className="mobile-hero" aria-label="TaskForceAI mobile hero">
    <div className="mobile-hero__top-row">
      <button
        type="button"
        className={MOBILE_HERO_HAMBURGER_CLASSES}
        onClick={onHamburgerClick}
        aria-label="Open sidebar"
      >
        <MobileHamburgerIcon />
      </button>

      {!isAuthenticated ? (
        <div className="mobile-hero__auth-buttons">
          <button type="button" className={MOBILE_HERO_AUTH_BUTTON_CLASSES} onClick={onSignIn}>
            Sign in
          </button>
        </div>
      ) : (
        <div className="mobile-hero__top-placeholder" aria-hidden="true"></div>
      )}
    </div>
    <div className="mobile-hero__center">
      <div className="relative h-24 w-24">
        <Image
          src="/icon.png"
          alt="TaskForceAI mark"
          fill
          sizes="96px"
          priority
          loading="eager"
          className={MOBILE_HERO_CENTER_LOGO_CLASSES}
        />
      </div>
      <p className="mobile-hero__wordmark">TaskForceAI</p>
      <p className="mobile-hero__subtitle">Multi-agent orchestration.</p>
    </div>
  </section>
);
