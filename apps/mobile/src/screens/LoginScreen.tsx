/**
 * Login Screen - Mobile authentication interface
 */
import * as AppleAuthentication from 'expo-apple-authentication';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  type AuthExchangeResponse,
  exchangeAppleToken,
  exchangeGoogleToken,
} from '../auth/token-exchange';
import { verifyAuthenticatorMFALogin } from '../auth/mfa-login';
import { persistAuthenticatedSession } from '../auth/session-store';
import { buildMobileUserState, type MobileUserState } from '../auth/user-state';
import { legalLinks } from '../config/legal-links';
import { useAuth } from '../contexts/AuthContext';
import { createModuleLogger } from '../logger';
import { colors } from '../theme/colors';
import { isAppleSignInAvailable, signInWithApple } from '../utils/apple-oauth';
import { signInWithGoogle } from '../utils/google-oauth';
import { styled } from '../utils/nativewind';

const StyledSafeAreaView = styled(SafeAreaView);
const logger = createModuleLogger('LoginScreen');

const openLegalLink = (url: string) => {
  Linking.openURL(url).catch((error: unknown) => {
    logger.error('Failed to open legal link', { error, url });
  });
};

interface LoginScreenProps {
  onSuccess?: () => void;
  onContinueAsGuest?: () => void;
}

type PendingMFAChallenge = {
  mfaToken: string;
  userProfile: MobileUserState;
};

const isMFARequiredResponse = (
  response: AuthExchangeResponse
): response is Extract<AuthExchangeResponse, { mfaRequired: true }> => 'mfaRequired' in response;

export function LoginScreen({
  onSuccess,
  onContinueAsGuest,
}: LoginScreenProps) {
  const { refreshUser, isAuthenticated } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [mfaCode, setMFACode] = useState('');
  const [pendingMFA, setPendingMFA] = useState<PendingMFAChallenge | null>(null);
  const [appleAvailable, setAppleAvailable] = useState(false);

  useEffect(() => {
    if (isAuthenticated) {
      logger.info('User is authenticated, triggering success callback');
      onSuccess?.();
    }
  }, [isAuthenticated, onSuccess]);

  useEffect(() => {
    void isAppleSignInAvailable().then(setAppleAvailable);
  }, []);

  const completeAuthExchange = async (
    response: AuthExchangeResponse,
    fallbackProfile: MobileUserState
  ) => {
    if (isMFARequiredResponse(response)) {
      setPendingMFA({
        mfaToken: response.mfaToken,
        userProfile: response.user,
      });
      setMFACode('');
      return;
    }

    await persistAuthenticatedSession({
      accessToken: response.accessToken,
      userProfile: response.user || fallbackProfile,
    });
    await refreshUser({ force: true });
  };

  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    try {
      const googleResult = await signInWithGoogle();
      if (!googleResult.idToken) {
        throw new Error('Google Sign-In failed: missing ID token');
      }

      const exchangeResponse = await exchangeGoogleToken({
        idToken: googleResult.idToken,
        accessToken: googleResult.accessToken,
      });

      const fallbackProfile = buildMobileUserState({
        email: googleResult.user.email,
        full_name: googleResult.user.name || null,
        plan: 'free',
      });

      await completeAuthExchange(exchangeResponse, fallbackProfile);
    } catch (error) {
      if (error instanceof Error && error.message === 'Authentication cancelled or failed') {
        return; // Silent on cancel
      }
      logger.error('Google sign-in failed', { error });
      Alert.alert(
        'Google Sign-In Failed',
        error instanceof Error ? error.message : 'Failed to sign in with Google'
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleAppleSignIn = async () => {
    setIsLoading(true);
    try {
      const appleResult = await signInWithApple();
      const exchangeResponse = await exchangeAppleToken({
        identityToken: appleResult.identityToken,
        authorizationCode: appleResult.authorizationCode,
        nonce: appleResult.nonce,
        email: appleResult.email,
        fullName: appleResult.fullName,
      });

      const fallbackProfile = buildMobileUserState({
        email: appleResult.email || '',
        full_name: appleResult.fullName || null,
        plan: 'free',
      });

      await completeAuthExchange(exchangeResponse, fallbackProfile);
    } catch (error) {
      if (error instanceof Error && error.message === 'Sign-In cancelled') {
        return; // Silent on cancel
      }
      logger.error('Apple sign-in failed', { error });
      Alert.alert(
        'Apple Sign-In Failed',
        error instanceof Error ? error.message : 'Failed to sign in with Apple'
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleMFAVerify = async () => {
    if (!pendingMFA) return;
    const code = mfaCode.trim();
    if (code.length < 6) {
      Alert.alert('Authenticator code required', 'Enter the 6-digit code from your authenticator app.');
      return;
    }

    setIsLoading(true);
    try {
      const response = await verifyAuthenticatorMFALogin(code, pendingMFA.mfaToken);
      if (!response.access_token) {
        throw new Error('Authenticator verification did not return a session token.');
      }
      await persistAuthenticatedSession({
        accessToken: response.access_token,
        userProfile: pendingMFA.userProfile,
      });
      setPendingMFA(null);
      setMFACode('');
      await refreshUser({ force: true });
    } catch (error) {
      logger.error('Authenticator verification failed', { error });
      Alert.alert(
        'Authenticator Verification Failed',
        error instanceof Error ? error.message : 'Invalid or expired authenticator code.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <StyledSafeAreaView className="flex-1">
      <LinearGradient colors={[colors.gradientTop, colors.gradientBottom]} style={{ flex: 1 }}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          <ScrollView
            contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24 }}
          >
            <View className="mb-12 items-center">
              <Text className="mb-2 text-4xl font-bold text-white">TaskForceAI</Text>
              <Text className="text-text-secondary text-lg">Your AI Command Center</Text>
            </View>

            <View className="rounded-3xl border border-white/10 bg-black/40 p-8">
              <Text className="mb-8 text-center text-xl font-semibold text-white">
                Sign in to sync your work
              </Text>
              <Text className="text-text-secondary mb-6 text-center text-sm leading-5">
                You can continue without an account to browse TaskForceAI and use local
                app features. Sign in when you want to sync, run AI tasks, or manage a
                subscription.
              </Text>

              {pendingMFA ? (
                <View>
                  <Text className="text-text-secondary mb-4 text-center text-sm">
                    Enter the 6-digit code from your authenticator app.
                  </Text>
                  <TextInput
                    value={mfaCode}
                    onChangeText={(value) => setMFACode(value.replace(/\D/g, '').slice(0, 6))}
                    keyboardType="number-pad"
                    textContentType="oneTimeCode"
                    autoComplete="one-time-code"
                    placeholder="000000"
                    placeholderTextColor={colors.textMuted}
                    editable={!isLoading}
                    maxLength={6}
                    testID="login-mfa-code-input"
                    className="mb-4 rounded-2xl border border-white/20 bg-white/10 px-4 py-4 text-center text-2xl font-semibold tracking-widest text-white"
                  />
                  <TouchableOpacity
                    className={`items-center justify-center rounded-2xl bg-white px-4 py-4 ${
                      isLoading ? 'opacity-60' : ''
                    }`}
                    onPress={() => {
                      void handleMFAVerify();
                    }}
                    disabled={isLoading}
                    testID="login-mfa-submit-button"
                  >
                    {isLoading ? <ActivityIndicator color="#111827" /> : null}
                    <Text className="text-center text-base font-semibold text-slate-950">
                      Continue
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    className="mt-4 items-center justify-center px-4 py-2"
                    onPress={() => {
                      setPendingMFA(null);
                      setMFACode('');
                    }}
                    disabled={isLoading}
                    testID="login-mfa-cancel-button"
                  >
                    <Text className="text-text-muted text-center text-sm">Back to sign in</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  {appleAvailable && (
                    <AppleAuthentication.AppleAuthenticationButton
                      buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                      buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
                      cornerRadius={16}
                      pointerEvents={isLoading ? 'none' : 'auto'}
                      style={{ width: '100%', height: 50, marginBottom: 16, opacity: isLoading ? 0.6 : 1 }}
                      onPress={() => {
                        if (!isLoading) void handleAppleSignIn();
                      }}
                    />
                  )}

                  <TouchableOpacity
                    className={`flex-row items-center justify-center rounded-2xl border border-white/20 bg-white/10 px-4 py-4 ${
                      isLoading ? 'opacity-60' : ''
                    }`}
                    onPress={() => { void handleGoogleSignIn(); }}
                    disabled={isLoading}
                    testID="login-google-button"
                  >
                    {isLoading && !appleAvailable ? (
                      <ActivityIndicator color={colors.textPrimary} className="mr-2" />
                    ) : null}
                    <Text className="text-center text-base font-semibold text-white">
                      Continue with Google
                    </Text>
                  </TouchableOpacity>

                  {onContinueAsGuest ? (
                    <TouchableOpacity
                      className="mt-4 items-center justify-center rounded-2xl border border-white/15 px-4 py-4"
                      onPress={onContinueAsGuest}
                      disabled={isLoading}
                      testID="login-guest-button"
                      accessibilityRole="button"
                    >
                      <Text className="text-center text-base font-semibold text-white">
                        Continue without an account
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </>
              )}

              <Text className="text-text-muted mt-8 text-center text-xs">
                By continuing, you agree to our{' '}
                <Text
                  className="text-primary font-semibold"
                  accessibilityRole="link"
                  onPress={() => openLegalLink(legalLinks.termsOfService)}
                  testID="login-terms-link"
                >
                  Terms of Service
                </Text>{' '}
                and{' '}
                <Text
                  className="text-primary font-semibold"
                  accessibilityRole="link"
                  onPress={() => openLegalLink(legalLinks.privacyPolicy)}
                  testID="login-privacy-link"
                >
                  Privacy Policy
                </Text>
                .
              </Text>
              <Text className="text-text-muted mt-4 text-center text-xs">
                Need help?{' '}
                <Text
                  className="text-primary font-semibold"
                  accessibilityRole="link"
                  onPress={() => openLegalLink(legalLinks.supportEmail)}
                  testID="login-support-link"
                >
                  Contact Support
                </Text>
              </Text>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </LinearGradient>
    </StyledSafeAreaView>
  );
}
