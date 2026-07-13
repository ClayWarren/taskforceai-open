import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Pressable, Text } from 'react-native';

import { MobileTaskModeSwitcher } from '../../components/MobileTaskModeSwitcher';

jest.mock('../../components/Icon', () => ({
  Icon: () => null,
}));

describe('MobileTaskModeSwitcher', () => {
  it('offers Chat and Work in the mode menu', () => {
    const onModeChange = jest.fn();
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <MobileTaskModeSwitcher mode="chat" onModeChange={onModeChange} />
      );
    });

    const selector = renderer!.root
      .findAllByType(Pressable)
      .find((button) => button.props.accessibilityLabel === 'Chat mode selector');
    expect(selector?.props.accessibilityState.expanded).toBe(false);
    act(() => selector?.props.onPress());

    const buttons = renderer!.root.findAllByType(Pressable);
    const chat = buttons.find((button) => button.props.accessibilityLabel === 'Chat mode');
    const work = buttons.find((button) => button.props.accessibilityLabel === 'Work mode');
    expect(chat?.props.accessibilityState.selected).toBe(true);
    const menuLabels = renderer!.root
      .findAllByType(Text)
      .filter((text) => text.props.children === 'Chat' || text.props.children === 'Work');
    expect(menuLabels.slice(-2).map((text) => text.props.style)).toEqual([
      { color: '#ffffff' },
      { color: '#ffffff' },
    ]);
    act(() => work?.props.onPress());
    expect(onModeChange).toHaveBeenCalledWith('work');
    expect(renderer!.root.findAllByType(Pressable)).toHaveLength(1);
  });

  it('does not expose Remote in the mode menu', () => {
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <MobileTaskModeSwitcher mode="work" onModeChange={jest.fn()} />
      );
    });

    const selector = renderer!.root
      .findAllByType(Pressable)
      .find((button) => button.props.accessibilityLabel === 'Work mode selector');
    act(() => selector?.props.onPress());
    const labels = renderer!.root
      .findAllByType(Pressable)
      .map((button) => button.props.accessibilityLabel);
    expect(labels).toContain('Work mode');
    expect(labels).not.toContain('Remote mode');
  });
});
