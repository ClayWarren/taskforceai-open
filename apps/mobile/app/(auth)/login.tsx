import { useCallback } from 'react';
import { useRouter } from 'expo-router';

import { LoginScreen } from '../../src/screens/LoginScreen';

export default function LoginRoute() {
  const router = useRouter();

  const handleSuccess = useCallback(() => {
    router.replace('/');
  }, [router]);

  return (
    <LoginScreen
      onSuccess={handleSuccess}
      onContinueAsGuest={handleSuccess}
    />
  );
}
