import { GlassView } from 'expo-glass-effect';
import { useTranslation } from 'react-i18next';
import { Text, TouchableOpacity, View } from 'react-native';

import { useTheme } from '../contexts/ThemeContext';
import { isGlassEffectSupported } from '../utils/glass';
import { styled } from '../utils/nativewind';
import { Icon } from './Icon';

const StyledGlassView = styled(GlassView) as any;
const StyledView = styled(View);
const defaultBoolean = (value: boolean | undefined, fallback = false): boolean => value ?? fallback;

interface HeaderProps {
  onMenuPress: () => void;
  onNewChatPress: () => void;
  isAuthenticated: boolean;
  onLoginPress: () => void;
  hasMessages?: boolean;
  isPrivateChat?: boolean;
  isPrivateChatToggleDisabled?: boolean;
  shouldRenderPrivateChatToggle?: boolean;
  onPrivateChatToggle?: () => void;
}

export function Header({
  onMenuPress,
  onNewChatPress,
  isAuthenticated,
  onLoginPress,
  hasMessages: optionalHasMessages,
  isPrivateChat: optionalPrivateChat,
  isPrivateChatToggleDisabled: optionalPrivateChatToggleDisabled,
  shouldRenderPrivateChatToggle: optionalShouldRenderPrivateChatToggle,
  onPrivateChatToggle,
}: HeaderProps) {
  const hasMessages = defaultBoolean(optionalHasMessages);
  const isPrivateChat = defaultBoolean(optionalPrivateChat);
  const isPrivateChatToggleDisabled = defaultBoolean(optionalPrivateChatToggleDisabled);
  const shouldRenderPrivateChatToggle = defaultBoolean(
    optionalShouldRenderPrivateChatToggle,
    isAuthenticated
  );
  const { theme } = useTheme();
  const { t } = useTranslation();
  const useGlass = isGlassEffectSupported();
  const PillComponent = useGlass ? StyledGlassView : StyledView;

  const glassProps = useGlass ? { glassEffectStyle: 'regular', tintColor: '#2a2a2a' } : {};
  const fallbackStyle = !useGlass
    ? { backgroundColor: theme.colors.cardBackground, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }
    : {};

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingTop: 10,
        paddingBottom: 8,
      }}
    >
      {/* Left: two separate glass bubbles — hamburger | TaskForceAI */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <TouchableOpacity
          onPress={onMenuPress}
          activeOpacity={0.75}
          accessibilityLabel={t('mobile.header.openMenu', 'Open navigation menu')}
          accessibilityRole="button"
          accessibilityHint={t('mobile.header.menuHint', 'View your conversation history')}
        >
          <PillComponent
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              alignItems: 'center',
              justifyContent: 'center',
              ...fallbackStyle,
            }}
            {...glassProps}
          >
            <Icon name="Menu" size={16} color={theme.colors.text} strokeWidth={2} />
          </PillComponent>
        </TouchableOpacity>

        <PillComponent
          style={{
            paddingHorizontal: 14,
            paddingVertical: 9,
            borderRadius: 22,
            ...fallbackStyle,
          }}
          {...glassProps}
        >
          <Text style={{ color: theme.colors.text, fontSize: 15, fontWeight: '600' }}>
            {t('mobile.header.title', 'TaskForceAI')}
          </Text>
        </PillComponent>
      </View>

      {/* Right: new-chat icon when authenticated+hasMessages, or login */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        {!isAuthenticated ? (
          <TouchableOpacity
            onPress={onLoginPress}
            activeOpacity={0.9}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 7,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: theme.colors.border,
            }}
            testID="header-login-button"
            accessibilityLabel={t('app.login', 'Login')}
            accessibilityRole="button"
          >
            <Text style={{ color: theme.colors.text, fontSize: 13, fontWeight: '600' }}>
              {t('app.login', 'Login')}
            </Text>
          </TouchableOpacity>
        ) : (
          <>
            {shouldRenderPrivateChatToggle && (
              <TouchableOpacity
                onPress={onPrivateChatToggle}
                activeOpacity={0.75}
                disabled={isPrivateChatToggleDisabled}
                testID="header-private-chat-button"
                accessibilityLabel={
                  isPrivateChat
                    ? t('mobile.header.privateChatOff', 'Turn off Private Chat')
                    : t('mobile.header.privateChatOn', 'Start Private Chat')
                }
                accessibilityRole="button"
                accessibilityState={{
                  selected: isPrivateChat,
                  disabled: isPrivateChatToggleDisabled,
                }}
                accessibilityHint={
                  isPrivateChat
                    ? t('mobile.header.privateChatOnHint', 'Private Chat is on')
                    : t('mobile.header.privateChatOffHint', 'Start a private chat')
                }
              >
                <PillComponent
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 20,
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: isPrivateChatToggleDisabled ? 0.45 : 1,
                    ...(!useGlass && {
                      backgroundColor: isPrivateChat
                        ? 'rgba(16,185,129,0.16)'
                        : theme.colors.cardBackground,
                      borderWidth: 1,
                      borderColor: isPrivateChat
                        ? 'rgba(110,231,183,0.55)'
                        : 'rgba(255,255,255,0.1)',
                    }),
                  }}
                  {...(useGlass ? { glassEffectStyle: 'regular', tintColor: '#2a2a2a' } : {})}
                >
                  <Icon
                    name={isPrivateChat ? 'ShieldCheck' : 'Shield'}
                    size={19}
                    color={isPrivateChat ? '#a7f3d0' : theme.colors.text}
                    strokeWidth={1.8}
                  />
                </PillComponent>
              </TouchableOpacity>
            )}
            {hasMessages && (
              <TouchableOpacity
                onPress={onNewChatPress}
                activeOpacity={0.75}
                accessibilityLabel={t('app.newChat', 'New Chat')}
                accessibilityRole="button"
                accessibilityHint={t('mobile.header.newChatHint', 'Start a fresh conversation')}
              >
                <PillComponent
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 20,
                    alignItems: 'center',
                    justifyContent: 'center',
                    ...(!useGlass && {
                      backgroundColor: theme.colors.cardBackground,
                      borderWidth: 1,
                      borderColor: 'rgba(255,255,255,0.1)',
                    }),
                  }}
                  {...(useGlass ? { glassEffectStyle: 'regular', tintColor: '#2a2a2a' } : {})}
                >
                  <Icon name="SquarePen" size={20} color={theme.colors.text} strokeWidth={1.5} />
                </PillComponent>
              </TouchableOpacity>
            )}
          </>
        )}
      </View>
    </View>
  );
}
