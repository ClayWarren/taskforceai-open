export const DESKTOP_APP_SERVER_AUTH_CHANGED_EVENT = 'taskforceai:desktop-auth-changed';

export const dispatchDesktopAppServerAuthChanged = () => {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new Event(DESKTOP_APP_SERVER_AUTH_CHANGED_EVENT));
};
