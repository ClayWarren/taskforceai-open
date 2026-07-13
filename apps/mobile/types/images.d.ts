import type { ImageSourcePropType } from 'react-native';

declare module '*.png' {
  const value: ImageSourcePropType;
  export default value;
}
