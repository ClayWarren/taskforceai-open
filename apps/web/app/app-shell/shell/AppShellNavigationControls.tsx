import { DesktopTaskModeSwitcher } from '../../components/shell/DesktopTaskModeSwitcher';
import type { DesktopTaskMode } from '../../lib/desktop/task-mode';
import { MobileHamburgerIcon } from '../navigation/icons';

interface AppShellNavigationControlsProps {
  desktopRuntime: boolean;
  isMobileViewport: boolean;
  mode?: DesktopTaskMode;
  onModeChange?: (_mode: DesktopTaskMode) => void;
  showMobileHero: boolean;
  onHamburgerClick: () => void;
}

export function AppShellNavigationControls({
  desktopRuntime,
  isMobileViewport,
  mode,
  onModeChange,
  showMobileHero,
  onHamburgerClick,
}: AppShellNavigationControlsProps) {
  const showWebTaskModeNavigation = !desktopRuntime && !isMobileViewport && mode && onModeChange;
  const showMobileHamburger = !showMobileHero && isMobileViewport;

  return (
    <>
      {showWebTaskModeNavigation ? (
        <div className="fixed top-4 left-1/2 z-[260] -translate-x-1/2 sm:top-5">
          <DesktopTaskModeSwitcher mode={mode} desktopRuntime={false} onModeChange={onModeChange} />
        </div>
      ) : null}
      {showMobileHamburger ? (
        <div className="fixed top-4 left-4 z-[250] md:hidden">
          <button
            type="button"
            className="mobile-hero__hamburger"
            onClick={onHamburgerClick}
            aria-label="Open sidebar"
          >
            <MobileHamburgerIcon />
          </button>
        </div>
      ) : null}
    </>
  );
}
