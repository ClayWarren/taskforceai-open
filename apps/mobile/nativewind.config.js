require('./scripts/nativewind-react-native-shim');
const path = require('path');

const nativewindEntryPath = require.resolve('nativewind');
const nativewindRoot = path.resolve(path.dirname(nativewindEntryPath), '..', '..');
const nativewindPluginPath = path.join(nativewindRoot, 'dist/commonjs/plugin.js');
const nativewind = require(nativewindPluginPath).default;
const { nativewindColors, radiusTokens, spacingTokens } = require('@taskforceai/design-tokens');

const spacing = Object.fromEntries(
  Object.entries(spacingTokens).map(([key, value]) => [key, `${value / 16}rem`])
);

const borderRadius = Object.fromEntries(
  Object.entries(radiusTokens).map(([key, value]) => [key, `${String(value)}px`])
);

module.exports = nativewind({
  content: ['./App.{js,jsx,ts,tsx}', './app/**/*.{js,jsx,ts,tsx}', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: nativewindColors('dark'),
      spacing,
      borderRadius,
    },
  },
  darkMode: 'class',
  plugins: [],
});
