import { colorTokens } from '@taskforceai/design-tokens';
import { Component, ErrorInfo, ReactNode } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

import { createModuleLogger } from '../logger';
import { Icon } from './Icon';

interface LocalErrorBoundaryProps {
    children: ReactNode;
    fallbackMessage?: string;
    contextId?: string;
    onRetry?: () => void;
}

interface LocalErrorBoundaryState {
    hasError: boolean;
    error: Error | null;
}

const logger = createModuleLogger('LocalErrorBoundary');

export class LocalErrorBoundary extends Component<LocalErrorBoundaryProps, LocalErrorBoundaryState> {
    constructor(props: LocalErrorBoundaryProps) {
        super(props);
        this.state = {
            hasError: false,
            error: null,
        };
    }

    static getDerivedStateFromError(error: Error): Partial<LocalErrorBoundaryState> {
        return { hasError: true, error };
    }

    override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
        logger.error('LocalErrorBoundary caught an error rendering component', {
            error,
            contextId: this.props.contextId,
            componentStack: errorInfo?.componentStack,
        });
    }

    handleReset = (): void => {
        this.setState({
            hasError: false,
            error: null,
        });
        this.props.onRetry?.();
    };

    override render(): ReactNode {
        if (this.state.hasError) {
            return (
                <View
                    className="mx-md my-sm flex-row items-center justify-between rounded-xl px-4 py-3"
                    style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)' }}
                >
                    <View className="flex-row items-center flex-1 pr-3">
                        <Icon name="AlertTriangle" size={16} color={colorTokens.dark.error} />
                        <Text className="ml-2 text-sm text-error flex-shrink">
                            {this.props.fallbackMessage || 'Failed to display this content.'}
                        </Text>
                    </View>

                    <TouchableOpacity
                        onPress={this.handleReset}
                        className="rounded-lg bg-error/20 px-3 py-1.5 active:opacity-70"
                    >
                        <Text className="text-xs font-semibold text-error">Retry</Text>
                    </TouchableOpacity>
                </View>
            );
        }

        return this.props.children;
    }
}
