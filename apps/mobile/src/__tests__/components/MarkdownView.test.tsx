import React from 'react';
import { render } from '@testing-library/react-native';
import { Linking } from 'react-native';

type MarkdownModuleMock = {
  __esModule: true;
  default: any;
};

const loadMarkdownView = (markdownModule: MarkdownModuleMock, loggerWarn: jest.Mock) => {
  let MarkdownView: any;

  jest.isolateModules(() => {
    jest.doMock('react-native-markdown-display', () => markdownModule);
    jest.doMock('../../contexts/ThemeContext', () => ({
      useTheme: () => ({
        theme: {
          colors: {
            text: '#d1d5db',
            textMuted: '#94a3b8',
            primary: '#3b82f6',
            border: '#334155',
          },
        },
      }),
    }));
    jest.doMock('../../logger', () => ({
      createModuleLogger: () => ({
        warn: loggerWarn,
      }),
    }));
    jest.doMock('expo-video', () => {
      const react = require('react');
      const { View } = require('react-native');
      return {
        __esModule: true,
        useVideoPlayer: (uri: string) => ({ uri }),
        VideoView: ({ player, ...props }: any) =>
          react.createElement(View, { testID: 'generated-media-video-player', player, ...props }),
      };
    });

    ({ MarkdownView } = require('../../components/MarkdownView'));
  });

  return MarkdownView;
};

describe('MarkdownView', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('returns null for null and blank content', () => {
    const warn = jest.fn();
    const MarkdownView = loadMarkdownView(
      {
        __esModule: true,
        default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
      },
      warn
    );

    const nullRender = render(<MarkdownView content={null} />);
    const blankRender = render(<MarkdownView content={'   '} />);

    expect(nullRender.toJSON()).toBeNull();
    expect(blankRender.toJSON()).toBeNull();
  });

  it('renders markdown output when markdown renderer is valid', () => {
    const warn = jest.fn();
    const MarkdownView = loadMarkdownView(
      {
        __esModule: true,
        default: ({ children, style }: { children: React.ReactNode; style: any }) => {
          const react = require('react');
          const { Text } = require('react-native');
          return react.createElement(Text, { testID: 'markdown-output', style: style.body }, children);
        },
      },
      warn
    );

    const { getByTestId } = render(<MarkdownView content={'**Hello**'} />);

    const markdown = getByTestId('markdown-output');
    expect(markdown.props.children).toBe('**Hello**');
    expect(markdown.props.style.color).toBe('#d1d5db');
  });

  it('uses user text color for user messages', () => {
    const warn = jest.fn();
    const MarkdownView = loadMarkdownView(
      {
        __esModule: true,
        default: ({ children, style }: { children: React.ReactNode; style: any }) => {
          const react = require('react');
          const { Text } = require('react-native');
          return react.createElement(Text, { testID: 'markdown-output', style: style.body }, children);
        },
      },
      warn
    );

    const { getByTestId } = render(<MarkdownView content={'User text'} isUser={true} />);

    expect(getByTestId('markdown-output').props.style.color).toBe('#ffffff');
  });

  it('renders generated image markdown as native media', () => {
    const warn = jest.fn();
    const MarkdownView = loadMarkdownView(
      {
        __esModule: true,
        default: ({ children }: { children: React.ReactNode }) => {
          const react = require('react');
          const { Text } = require('react-native');
          return react.createElement(Text, { testID: 'markdown-output' }, children);
        },
      },
      warn
    );

    const { getByTestId, queryByTestId } = render(
      <MarkdownView content={'![Generated Image](https://example.test/image.png)'} />
    );

    expect(getByTestId('generated-media-image').props.source.uri).toBe(
      'https://example.test/image.png'
    );
    expect(queryByTestId('markdown-output')).toBeNull();
  });

  it('renders generated video markdown as an inline native player', () => {
    const warn = jest.fn();
    const MarkdownView = loadMarkdownView(
      {
        __esModule: true,
        default: ({ children }: { children: React.ReactNode }) => {
          const react = require('react');
          const { Text } = require('react-native');
          return react.createElement(Text, { testID: 'markdown-output' }, children);
        },
      },
      warn
    );

    const { getByTestId, getByText } = render(
      <MarkdownView
        content={
          '<video controls><source src="https://example.test/generated.mp4" type="video/mp4"></video>'
        }
      />
    );

    expect(getByTestId('generated-media-video')).toBeTruthy();
    expect(getByTestId('generated-media-video-player').props.player.uri).toBe(
      'https://example.test/generated.mp4'
    );
    expect(getByText('Open generated video')).toBeTruthy();
  });

  it('does not open generated media links with unsafe schemes', () => {
    const warn = jest.fn();
    const openUrlSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
    const MarkdownView = loadMarkdownView(
      {
        __esModule: true,
        default: ({ children }: { children: React.ReactNode }) => {
          const react = require('react');
          const { Text } = require('react-native');
          return react.createElement(Text, { testID: 'markdown-output' }, children);
        },
      },
      warn
    );

    const { queryByTestId } = render(
      <MarkdownView
        content={'<video controls><source src="taskforceai://open-secret" type="video/mp4"></video>'}
      />
    );

    expect(queryByTestId('generated-media-video')).toBeNull();
    expect(openUrlSpy).not.toHaveBeenCalled();
  });

  it('falls back to plain Text when markdown module is not renderable', () => {
    const warn = jest.fn();
    const MarkdownView = loadMarkdownView(
      {
        __esModule: true,
        default: { invalid: true },
      },
      warn
    );

    const { getByText } = render(<MarkdownView content={'Fallback content'} />);

    expect(getByText('Fallback content')).toBeTruthy();
    expect(warn).not.toHaveBeenCalled();
  });

});
