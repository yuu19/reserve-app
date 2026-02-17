import { createAuthClient } from 'better-auth/react';
import { Platform } from 'react-native';

export const backendBaseURL = process.env.EXPO_PUBLIC_BACKEND_URL ?? 'http://localhost:3000';
export const isWebPlatform = Platform.OS === 'web';

const getPlugins = () => {
  if (isWebPlatform) {
    return [];
  }

  // Load native-only dependencies lazily to avoid web startup crashes.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { expoClient } = require('@better-auth/expo/client') as typeof import('@better-auth/expo/client');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const SecureStore = require('expo-secure-store') as typeof import('expo-secure-store');

  return [
    expoClient({
      scheme: 'mobile',
      storagePrefix: 'better-auth-organization-demo',
      storage: SecureStore,
    }),
  ];
};

export const authClient = createAuthClient({
  baseURL: backendBaseURL,
  plugins: getPlugins(),
  fetchOptions: {
    credentials: isWebPlatform ? 'include' : 'omit',
  },
});

type AuthClientWithCookie = typeof authClient & {
  getCookie?: () => string;
};

export const getAuthCookie = () => {
  if (isWebPlatform) {
    return null;
  }
  const cookie = (authClient as AuthClientWithCookie).getCookie?.();
  return cookie && cookie.length > 0 ? cookie : null;
};
