import * as SecureStore from 'expo-secure-store';

const AUTH_TOKEN_KEY = 'taskforceai_auth_token';

export const getAuthToken = (): Promise<string | null> => {
  return SecureStore.getItemAsync(AUTH_TOKEN_KEY);
};

export const setAuthToken = (token: string): Promise<void> => {
  return SecureStore.setItemAsync(AUTH_TOKEN_KEY, token);
};

export const clearAuthToken = (): Promise<void> => {
  return SecureStore.deleteItemAsync(AUTH_TOKEN_KEY);
};
