import { Linking } from 'react-native';

type UrlEvent = {
  url: string;
};

export const getInitialUrl = () => Linking.getInitialURL();

export const subscribeUrlEvents = (handler: (event: UrlEvent) => void) =>
  Linking.addEventListener('url', handler);
