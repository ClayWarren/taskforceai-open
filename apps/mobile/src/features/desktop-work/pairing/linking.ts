import { Linking } from 'react-native';

/** React Native linking adapter for the Desktop Work pairing flow. */

type UrlEvent = {
  url: string;
};

export const getInitialUrl = () => Linking.getInitialURL();

export const subscribeUrlEvents = (handler: (event: UrlEvent) => void) =>
  Linking.addEventListener('url', handler);
