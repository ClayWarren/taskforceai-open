const React = require('react');
const { render } = require('@testing-library/react-native');
const ReactNative = require('react-native');

const createAnimatedComponent = (name: string) => (props: any) =>
  React.createElement(name, props, props.children);

function PatchedAnimatedValue(this: { value: number; interpolate: (config: unknown) => unknown }, value: number) {
  this.value = value;
  this.interpolate = (config: unknown) => config;
}

Object.assign(ReactNative, {
  Animated: {
    Value: PatchedAnimatedValue,
    View: createAnimatedComponent('Animated.View'),
    timing: jest.fn(() => ({ start: jest.fn(), stop: jest.fn() })),
    sequence: jest.fn(() => ({ start: jest.fn(), stop: jest.fn() })),
    loop: jest.fn(() => ({ start: jest.fn(), stop: jest.fn() })),
  },
  Easing: {
    ease: 'ease',
    inOut: (value: unknown) => value,
  },
});

const { RealtimeVoiceSessionPanel } = require('../../components/RealtimeVoiceSessionPanel');

describe('RealtimeVoiceSessionPanel', () => {
  it('renders nothing before a voice session starts', () => {
    const { toJSON } = render(
      <RealtimeVoiceSessionPanel
        endedDurationMs={null}
        isActive={false}
        isCapturing={false}
        isPlaying={false}
      />
    );

    expect(toJSON()).toBeNull();
  });

  it('renders ended session durations in seconds and minutes', () => {
    const { getByText, rerender } = render(
      <RealtimeVoiceSessionPanel
        endedDurationMs={250}
        isActive={false}
        isCapturing={false}
        isPlaying={false}
      />
    );

    expect(getByText('Voice chat ended - 1s')).toBeTruthy();

    rerender(
      <RealtimeVoiceSessionPanel
        endedDurationMs={61_000}
        isActive={false}
        isCapturing={false}
        isPlaying={false}
      />
    );

    expect(getByText('Voice chat ended - 1:01')).toBeTruthy();
  });

  it('labels active voice activity states', () => {
    const { getByLabelText, rerender } = render(
      <RealtimeVoiceSessionPanel
        endedDurationMs={null}
        isActive={true}
        isCapturing={true}
        isPlaying={false}
      />
    );

    expect(getByLabelText('Listening')).toBeTruthy();

    rerender(
      <RealtimeVoiceSessionPanel
        endedDurationMs={null}
        isActive={true}
        isCapturing={false}
        isPlaying={true}
      />
    );
    expect(getByLabelText('Speaking')).toBeTruthy();

    rerender(
      <RealtimeVoiceSessionPanel
        endedDurationMs={null}
        isActive={true}
        isCapturing={false}
        isPlaying={false}
      />
    );
    expect(getByLabelText('Voice session')).toBeTruthy();
  });
});
