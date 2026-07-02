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

    it('renders title and tagline', () => {
        const { getByText } = render(<Header {...defaultProps} />);
        expect(getByText('TaskForceAI')).toBeTruthy();
    });

    it('shows login button when not authenticated', () => {
        const { getByTestId } = render(<Header {...defaultProps} />);
        expect(getByTestId('header-login-button')).toBeTruthy();
    });

    it('calls onLoginPress when login button pressed', () => {
        const onLoginPress = jest.fn();
        const { getByTestId } = render(
            <Header {...defaultProps} onLoginPress={onLoginPress} />
        );
        fireEvent.press(getByTestId('header-login-button'));
        expect(onLoginPress).toHaveBeenCalledTimes(1);
    });

    it('calls onMenuPress when menu button pressed', () => {
        const onMenuPress = jest.fn();
        const { getByLabelText } = render(
            <Header {...defaultProps} onMenuPress={onMenuPress} />
        );
        fireEvent.press(getByLabelText('Open navigation menu'));
        expect(onMenuPress).toHaveBeenCalledTimes(1);
    });

    it('shows new chat button when authenticated with messages', () => {
        const { getByLabelText, queryByTestId } = render(
            <Header {...defaultProps} isAuthenticated={true} hasMessages={true} />
        );
        expect(getByLabelText('New Chat')).toBeTruthy();
        expect(queryByTestId('header-login-button')).toBeNull();
    });

    it('calls onNewChatPress when new chat button pressed', () => {
        const onNewChatPress = jest.fn();
        const { getByLabelText } = render(
            <Header {...defaultProps} isAuthenticated={true} hasMessages={true} onNewChatPress={onNewChatPress} />
        );
        fireEvent.press(getByLabelText('New Chat'));
        expect(onNewChatPress).toHaveBeenCalledTimes(1);
    });

    it('hides new chat button when no messages', () => {
        const { queryByLabelText } = render(
            <Header {...defaultProps} isAuthenticated={true} hasMessages={false} />
        );
        expect(queryByLabelText('New Chat')).toBeNull();
    });

    it('hides new chat button when not authenticated', () => {
        const { queryByLabelText } = render(
            <Header {...defaultProps} isAuthenticated={false} hasMessages={true} />
        );
        expect(queryByLabelText('New Chat')).toBeNull();
    });
});
