import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { Text, TouchableOpacity } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

import { RateLimitError } from '../../components/RateLimitError';

jest.useFakeTimers();

const mockPurchasePro = jest.fn();
let mockIsProcessing = false;
jest.mock('../../hooks/usePurchases', () => ({
  usePurchases: () => ({
    purchasePro: mockPurchasePro,
    isProcessing: mockIsProcessing,
  }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'mobile.rateLimit.title': 'Rate Limit Reached',
        'mobile.rateLimit.resetIn': 'Resets in:',
        'mobile.rateLimit.upgrade': 'Upgrade to Pro',
        'mobile.rateLimit.hint': 'Pro users have higher rate limits',
      };
      return translations[key] ?? key;
    },
  }),
}));

describe('RateLimitError', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
    mockIsProcessing = false;
  });

  it('renders error message', () => {
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <RateLimitError message="Too many requests" />
      );
    });

    const texts = renderer!.root.findAllByType(Text);
    expect(texts.some((t) => t.props.children === 'Too many requests')).toBe(
      true
    );
  });

  it('renders title', () => {
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <RateLimitError message="Error message" />
      );
    });

    const texts = renderer!.root.findAllByType(Text);
    expect(texts.some((t) => t.props.children === 'Rate Limit Reached')).toBe(
      true
    );
  });

  it('shows countdown when resetTime provided', () => {
    const futureTime = new Date(Date.now() + 90000).toISOString();
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <RateLimitError message="Rate limited" resetTime={futureTime} />
      );
    });

    const texts = renderer!.root.findAllByType(Text);
    const countdownText = texts.find(
      (t) =>
        typeof t.props.children === 'string' && t.props.children.includes('s')
    );
    expect(countdownText).toBeDefined();
  });

  it('updates countdown every second', () => {
    const futureTime = new Date(Date.now() + 65000).toISOString();
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <RateLimitError message="Rate limited" resetTime={futureTime} />
      );
    });

    const getTexts = () => renderer!.root.findAllByType(Text);

    const initialTexts = getTexts();
    const initialCountdown = initialTexts.find(
      (t) =>
        typeof t.props.children === 'string' &&
        /\d+m \d+s/.test(t.props.children)
    );
    expect(initialCountdown).toBeDefined();

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    const updatedTexts = getTexts();
    const updatedCountdown = updatedTexts.find(
      (t) =>
        typeof t.props.children === 'string' &&
        /\d+m \d+s/.test(t.props.children)
    );
    expect(updatedCountdown).toBeDefined();
  });

  it('shows Ready to retry when time expires', () => {
    const pastTime = new Date(Date.now() - 1000).toISOString();
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <RateLimitError message="Rate limited" resetTime={pastTime} />
      );
    });

    const texts = renderer!.root.findAllByType(Text);
    expect(texts.some((t) => t.props.children === 'Ready to retry')).toBe(true);
  });

  it('calls onUpgrade when upgrade button pressed', () => {
    const onUpgrade = jest.fn();
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <RateLimitError message="Rate limited" onUpgrade={onUpgrade} />
      );
    });

    const buttons = renderer!.root.findAllByType(TouchableOpacity);
    const upgradeButton = buttons.find((b) => {
      try {
        const text = b.findByType(Text);
        return text.props.children === 'Upgrade to Pro';
      } catch {
        return false;
      }
    });

    act(() => {
      upgradeButton!.props.onPress();
    });

    expect(onUpgrade).toHaveBeenCalledTimes(1);
  });

  it('calls purchasePro when no onUpgrade provided', () => {
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<RateLimitError message="Rate limited" />);
    });

    const buttons = renderer!.root.findAllByType(TouchableOpacity);
    const upgradeButton = buttons.find((b) => {
      try {
        const text = b.findByType(Text);
        return text.props.children === 'Upgrade to Pro';
      } catch {
        return false;
      }
    });

    act(() => {
      upgradeButton!.props.onPress();
    });

    expect(mockPurchasePro).toHaveBeenCalledTimes(1);
  });

  it('shows upgrade progress while a purchase is processing', () => {
    mockIsProcessing = true;
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<RateLimitError message="Rate limited" />);
    });

    const upgradeButton = renderer!.root.findAllByType(TouchableOpacity).find((button) =>
      button.props.className?.includes('bg-primary')
    );
    expect(upgradeButton?.props.disabled).toBe(true);
  });

  it('calls onDismiss when dismiss button pressed', () => {
    const onDismiss = jest.fn();
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <RateLimitError message="Rate limited" onDismiss={onDismiss} />
      );
    });

    const buttons = renderer!.root.findAllByType(TouchableOpacity);
    const dismissButton = buttons.find((b) => {
      const allProps = b.props;
      return allProps.className?.includes('rounded-full');
    });

    act(() => {
      dismissButton!.props.onPress();
    });

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('clears interval on unmount', () => {
    const futureTime = new Date(Date.now() + 60000).toISOString();
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <RateLimitError message="Rate limited" resetTime={futureTime} />
      );
    });

    act(() => {
      renderer!.unmount();
    });

    const timerCount = jest.getTimerCount();
    expect(timerCount).toBe(0);
  });
});
