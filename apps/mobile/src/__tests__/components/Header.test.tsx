import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { Header } from '../../components/Header';

jest.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, bottom: 20, left: 0, right: 0 }),
}));

jest.mock('../../contexts/ThemeContext', () => ({
    useTheme: () => ({
        theme: {
            colors: {
                overlay: 'rgba(0,0,0,0.5)',
                background: '#000000',
                text: '#ffffff',
            },
        },
    }),
}));

jest.mock('../../screens/SettingsScreen', () => ({
    SettingsScreen: () => null,
}));

jest.mock('react-i18next', () =>
    require('../helpers/mock-modules').createTranslationMockModule()
);

const defaultProps = {
    onMenuPress: jest.fn(),
    onNewChatPress: jest.fn(),
    isAuthenticated: false,
    onLoginPress: jest.fn(),
};

describe('Header', () => {
    beforeEach(() => jest.clearAllMocks());

    it('renders title and tagline', async () => {
        const { getByText } = await render(<Header {...defaultProps} />);
        expect(getByText('TaskForceAI')).toBeTruthy();
    });

    it('renders the task mode selector in the header and changes mode', async () => {
        const onTaskModeChange = jest.fn();
        const { getByLabelText, getByTestId } = await render(
            <Header
                {...defaultProps}
                taskMode="chat"
                onTaskModeChange={onTaskModeChange}
            />
        );

        expect(getByTestId('mobile-task-mode-switcher')).toBeTruthy();
        await fireEvent.press(getByLabelText('Chat mode selector'));
        await fireEvent.press(getByLabelText('Work mode'));

        expect(onTaskModeChange).toHaveBeenCalledWith('work');
    });

    it('shows login button when not authenticated', async () => {
        const { getByTestId } = await render(<Header {...defaultProps} />);
        expect(getByTestId('header-login-button')).toBeTruthy();
    });

    it('calls onLoginPress when login button pressed', async () => {
        const onLoginPress = jest.fn();
        const { getByTestId } = await render(
            <Header {...defaultProps} onLoginPress={onLoginPress} />
        );
        await fireEvent.press(getByTestId('header-login-button'));
        expect(onLoginPress).toHaveBeenCalledTimes(1);
    });

    it('calls onMenuPress when menu button pressed', async () => {
        const onMenuPress = jest.fn();
        const { getByLabelText } = await render(
            <Header {...defaultProps} onMenuPress={onMenuPress} />
        );
        await fireEvent.press(getByLabelText('Open navigation menu'));
        expect(onMenuPress).toHaveBeenCalledTimes(1);
    });

    it('shows new chat button when authenticated with messages', async () => {
        const { getByLabelText, queryByTestId } = await render(
            <Header {...defaultProps} isAuthenticated={true} hasMessages={true} />
        );
        expect(getByLabelText('New Chat')).toBeTruthy();
        expect(queryByTestId('header-login-button')).toBeNull();
    });

    it('shows private chat toggle only when authenticated', async () => {
        const { getByTestId, rerender, queryByTestId } = await render(
            <Header
                {...defaultProps}
                isAuthenticated={true}
                shouldRenderPrivateChatToggle={true}
            />
        );

        expect(getByTestId('header-private-chat-button')).toBeTruthy();

        await rerender(
            <Header
                {...defaultProps}
                isAuthenticated={false}
                shouldRenderPrivateChatToggle={true}
            />
        );

        expect(queryByTestId('header-private-chat-button')).toBeNull();
    });

    it('calls private chat toggle and reflects active state labels', async () => {
        const onPrivateChatToggle = jest.fn();
        const { getByLabelText, rerender } = await render(
            <Header
                {...defaultProps}
                isAuthenticated={true}
                shouldRenderPrivateChatToggle={true}
                onPrivateChatToggle={onPrivateChatToggle}
            />
        );

        await fireEvent.press(getByLabelText('Start Private Chat'));
        expect(onPrivateChatToggle).toHaveBeenCalledTimes(1);

        await rerender(
            <Header
                {...defaultProps}
                isAuthenticated={true}
                isPrivateChat={true}
                shouldRenderPrivateChatToggle={true}
                onPrivateChatToggle={onPrivateChatToggle}
            />
        );

        expect(getByLabelText('Turn off Private Chat')).toBeTruthy();
    });

    it('disables private chat toggle when requested', async () => {
        const onPrivateChatToggle = jest.fn();
        const { getByTestId } = await render(
            <Header
                {...defaultProps}
                isAuthenticated={true}
                shouldRenderPrivateChatToggle={true}
                isPrivateChatToggleDisabled={true}
                onPrivateChatToggle={onPrivateChatToggle}
            />
        );

        const button = getByTestId('header-private-chat-button');
        expect(button.props.accessibilityState.disabled).toBe(true);
        expect(button.props.disabled).toBe(true);
    });

    it('calls onNewChatPress when new chat button pressed', async () => {
        const onNewChatPress = jest.fn();
        const { getByLabelText } = await render(
            <Header {...defaultProps} isAuthenticated={true} hasMessages={true} onNewChatPress={onNewChatPress} />
        );
        await fireEvent.press(getByLabelText('New Chat'));
        expect(onNewChatPress).toHaveBeenCalledTimes(1);
    });

    it('hides new chat button when no messages', async () => {
        const { queryByLabelText } = await render(
            <Header {...defaultProps} isAuthenticated={true} hasMessages={false} />
        );
        expect(queryByLabelText('New Chat')).toBeNull();
    });

    it('hides new chat button when not authenticated', async () => {
        const { queryByLabelText } = await render(
            <Header {...defaultProps} isAuthenticated={false} hasMessages={true} />
        );
        expect(queryByLabelText('New Chat')).toBeNull();
    });
});
