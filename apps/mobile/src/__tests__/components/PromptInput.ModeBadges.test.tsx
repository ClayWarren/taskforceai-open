import { describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text, TouchableOpacity } from 'react-native';

import { ModeBadges } from '../../components/PromptInput.ModeBadges';

jest.mock('../../components/Icon', () => ({
    Icon: (props: any) => {
        const react = require('react');
        return react.createElement('Icon', props);
    },
}));

describe('ModeBadges', () => {
    it('renders nothing when no badges are enabled', () => {
        let renderer: TestRenderer.ReactTestRenderer;
        act(() => {
            renderer = TestRenderer.create(
                <ModeBadges badges={[
                    { id: 'direct', label: 'Direct Chat', iconName: 'Zap', enabled: false },
                ]} />
            );
        });

        expect(renderer!.toJSON()).toBeNull();
    });

    it('renders enabled badges', () => {
        let renderer: TestRenderer.ReactTestRenderer;
        act(() => {
            renderer = TestRenderer.create(
                <ModeBadges badges={[
                    { id: 'direct', label: 'Direct Chat', iconName: 'Zap', enabled: true },
                    { id: 'auto', label: 'Auto', iconName: 'Sparkles', enabled: true },
                    { id: 'disabled', label: 'Off', iconName: 'X', enabled: false },
                ]} />
            );
        });

        const texts = renderer!.root.findAllByType(Text);
        const labels = texts.map(t => t.props.children);
        expect(labels).toContain('Direct Chat');
        expect(labels).toContain('Auto');
        expect(labels).not.toContain('Off');
    });

    it('renders dismiss button when onDismiss provided', () => {
        const onDismiss = jest.fn();
        let renderer: TestRenderer.ReactTestRenderer;
        act(() => {
            renderer = TestRenderer.create(
                <ModeBadges badges={[
                    { id: 'direct', label: 'Direct Chat', iconName: 'Zap', enabled: true, onDismiss },
                ]} />
            );
        });

        const buttons = renderer!.root.findAllByType(TouchableOpacity);
        const dismissButton = buttons.find(b =>
            b.props.accessibilityLabel?.includes('Disable')
        );
        expect(dismissButton).toBeDefined();

        act(() => {
            dismissButton!.props.onPress();
        });

        expect(onDismiss).toHaveBeenCalled();
    });

    it('does not render dismiss button when no onDismiss', () => {
        let renderer: TestRenderer.ReactTestRenderer;
        act(() => {
            renderer = TestRenderer.create(
                <ModeBadges badges={[
                    { id: 'direct', label: 'Direct Chat', iconName: 'Zap', enabled: true },
                ]} />
            );
        });

        const buttons = renderer!.root.findAllByType(TouchableOpacity);
        const dismissButton = buttons.find(b =>
            b.props.accessibilityLabel?.includes('Disable')
        );
        expect(dismissButton).toBeUndefined();
    });
});
