import React from 'react';

const MockComponent = (name: string) => {
  const Component = (props: any) => {
    const { children, ...rest } = props;
    return React.createElement(name, rest, children);
  };
  Component.displayName = name;
  return Component;
};

export const TouchableOpacity = MockComponent('TouchableOpacity');
export const Text = MockComponent('Text');
export const View = MockComponent('View');
export const ActivityIndicator = MockComponent('ActivityIndicator');
export const Image = MockComponent('Image');
export const ScrollView = MockComponent('ScrollView');
export const TextInput = MockComponent('TextInput');
export const KeyboardAvoidingView = MockComponent('KeyboardAvoidingView');
export const Pressable = MockComponent('Pressable');
export const Modal = MockComponent('Modal');
export const FlatList = MockComponent('FlatList');
export const SectionList = MockComponent('SectionList');
export const Switch = MockComponent('Switch');
export const StatusBar = MockComponent('StatusBar');
export const Button = MockComponent('Button');
export const RefreshControl = MockComponent('RefreshControl');
export const ImageBackground = MockComponent('ImageBackground');

export const useCssElement = () => null;
export const useCss = () => ({});

export const Platform = {
  OS: 'ios',
  select: (objs: any) => objs.ios || objs.default,
};

export const StyleSheet = {
  create: (obj: any) => obj,
  flatten: (obj: any) => obj,
};

export const Alert = {
  alert: jest.fn(),
};

export const Keyboard = {
  dismiss: jest.fn(),
  addListener: jest.fn(() => ({ remove: jest.fn() })),
};

export const useWindowDimensions = jest.fn(() => ({
  width: 390,
  height: 844,
  scale: 3,
  fontScale: 1,
}));

export const LayoutAnimation = {
  configureNext: jest.fn(),
  Presets: {
    easeInEaseOut: {},
  },
};

export const Animated = {
  View: MockComponent('Animated.View'),
  Text: MockComponent('Animated.Text'),
  createAnimatedComponent: (c: any) => c,
  Value: () => ({
    interpolate: () => ({}),
    setValue: () => {},
  }),
  timing: () => ({ start: () => {} }),
  spring: () => ({ start: () => {} }),
};

export default {
  TouchableOpacity,
  Text,
  View,
  ActivityIndicator,
  Image,
  ScrollView,
  TextInput,
  KeyboardAvoidingView,
  Pressable,
  Modal,
  FlatList,
  SectionList,
  Switch,
  StatusBar,
  Button,
  RefreshControl,
  ImageBackground,
  useCssElement,
  useCss,
  Platform,
  StyleSheet,
  Alert,
  Keyboard,
  useWindowDimensions,
  LayoutAnimation,
  Animated,
};
