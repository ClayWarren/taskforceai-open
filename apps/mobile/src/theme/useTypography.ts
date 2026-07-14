import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import { typographyTokens } from '@taskforceai/design-tokens';
import { useFonts } from 'expo-font';
import React, { useEffect } from 'react';
import {
  StyleProp,
  Text,
  TextInput,
  type TextInputProps,
  type TextProps,
  type TextStyle,
} from 'react-native';

const weightToFontFamily: Record<string, string> = {
  normal: typographyTokens.fonts.regular,
  '400': typographyTokens.fonts.regular,
  '500': typographyTokens.fonts.medium,
  '600': typographyTokens.fonts.semibold,
  '700': typographyTokens.fonts.bold,
  '800': typographyTokens.fonts.bold,
  '900': typographyTokens.fonts.bold,
  bold: typographyTokens.fonts.bold,
};

let textRendererPatched = false;

const flattenStyle = (style?: StyleProp<TextStyle>): TextStyle | undefined => {
  if (!style) {
    return undefined;
  }

  if (Array.isArray(style)) {
    // Type assertion justified: Narrowing array to readonly array of styles after Array.isArray check
    const styleArray = style as ReadonlyArray<StyleProp<TextStyle>>;
    return styleArray.reduce<TextStyle | undefined>((acc, item) => {
      const flattenedItem = flattenStyle(item);
      if (!flattenedItem) {
        return acc;
      }
      if (!acc) {
        return { ...flattenedItem };
      }
      return Object.assign({}, acc, flattenedItem);
    }, undefined);
  }

  if (typeof style === 'object') {
    return style;
  }

  return undefined;
};

const withFontFamily = (style?: StyleProp<TextStyle>): StyleProp<TextStyle> => {
  const flattened = flattenStyle(style);

  if (flattened?.fontFamily) {
    return style;
  }

  const resolvedFamily =
    (flattened?.fontWeight && weightToFontFamily[String(flattened.fontWeight)]) ||
    typographyTokens.fonts.regular;

  if (!style) {
    return [{ fontFamily: resolvedFamily }];
  }

  if (Array.isArray(style)) {
    // Type assertion justified: Narrowing array to readonly array of styles after Array.isArray check
    return [...(style as ReadonlyArray<StyleProp<TextStyle>>), { fontFamily: resolvedFamily }];
  }

  return [style, { fontFamily: resolvedFamily }];
};

const patchTextRenderer = () => {
  if (textRendererPatched) {
    return;
  }

  type PatchableText = typeof Text & {
    render?: (...args: Parameters<typeof React.createElement>) => React.ReactElement<TextProps>;
  };

  // Type assertion justified: Augmenting Text component type to access internal render method
  const textComponent = Text as PatchableText;
  const originalRender = textComponent.render;

  if (typeof originalRender !== 'function') {
    // Fallback: apply default font family globally when render is not patchable.
    // Type assertion justified: Augmenting Text type to access/set defaultProps property
    const defaultProps = (Text as typeof Text & { defaultProps?: TextProps }).defaultProps || {};
    (Text as typeof Text & { defaultProps?: TextProps }).defaultProps = {
      ...defaultProps,
      // Type assertion justified: Narrowing style array to TextProps['style'] for defaultProps assignment
      style: withFontFamily(defaultProps.style),
    };
    textRendererPatched = true;
    return;
  }

  textComponent.render = function render(...args) {
    const origin = originalRender.apply(this, args);
    const patchedStyle = withFontFamily(origin.props.style);

    if (patchedStyle === origin.props.style) {
      return origin;
    }

    return React.cloneElement(origin, {
      style: patchedStyle,
    });
  };

  textRendererPatched = true;
};

export function useTypography(): boolean {
  const [fontsLoaded] = useFonts({
    [typographyTokens.fonts.regular]: Inter_400Regular,
    [typographyTokens.fonts.medium]: Inter_500Medium,
    [typographyTokens.fonts.semibold]: Inter_600SemiBold,
    [typographyTokens.fonts.bold]: Inter_700Bold,
  });

  useEffect(() => {
    if (!fontsLoaded) {
      return;
    }

    patchTextRenderer();

    type PatchableTextInput = typeof TextInput & { defaultProps?: TextInputProps };
    // Type assertion justified: Augmenting TextInput type to access/set defaultProps property
    const textInputComponent = TextInput as PatchableTextInput;

    if (!textInputComponent.defaultProps) {
      textInputComponent.defaultProps = {};
    }

    // Type assertion justified: Narrowing style array to TextInputProps['style'] for defaultProps assignment
    textInputComponent.defaultProps.style = withFontFamily(
      textInputComponent.defaultProps.style
    );
  }, [fontsLoaded]);

  return fontsLoaded;
}
