export const createIconMockModule = () => ({
  Icon: ({ name }: { name: string }) => {
    const React = require('react');
    const { Text } = require('react-native');
    return React.createElement(Text, { testID: `icon-${name}` }, name);
  },
});

export const createTranslationMockModule = () => ({
  useTranslation: () => ({
    t: (key: string, value?: string | { defaultValue?: string }) => {
      if (typeof value === 'string') return value;
      return value?.defaultValue ?? key;
    },
    i18n: { changeLanguage: jest.fn() },
  }),
});
