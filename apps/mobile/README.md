# TaskForceAI Mobile App

React Native (Expo) client that mirrors the TaskForceAI web console with a liquid-glass aesthetic on iOS and a dark, edge-to-edge layout on Android.

> **Public Beta**: TaskForceAI Mobile is now live in public beta on **iOS TestFlight** and **Google Play**.

## Table of Contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Development](#development)
- [Building](#building)
- [Project Structure](#project-structure)
- [Shared Code](#shared-code)
- [Styling & Theming](#styling--theming)
- [Platform-Specific Features](#platform-specific-features)
- [Testing](#testing)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)

## Overview

TaskForceAI Mobile keeps the same workflow you see in the web console: live run telemetry, chat hand-off, and status summaries, all rendered with the dark, “liquid glass” look introduced on macOS/iOS Tahoe. Shared utilities live in the `packages/shared-ts` workspace (aliased as `@shared/*`) so business logic stays aligned across platforms.

**Technology Stack**:

- **React Native** 0.81.4 + **Expo** 54 for runtime + build tooling
- **TypeScript** (~5.9) with `strict` mode enabled for the mobile workspace
- **React** 19.1 paired with **NativeWind** for token-driven styling
- **Drizzle ORM** on top of `expo-sqlite` for typed, migrated local storage
- **Zod** for runtime validation of environment config and API contracts (mirrors the web app)
- **React Query** for server-state caching, offline queues, and retry-aware mutations
- **Jest** + **Detox** for unit/integration and device-level test coverage
- **Sentry** for runtime crash/error telemetry
- **RevenueCat** for subscription/billing flows

## Prerequisites

### Required Software

- **Node.js**: 24.11+ (matches TaskForceAI root workspace)
- **Bun**: 1.3+ (package manager + task runner)
- **Expo CLI**: Installed via npx or globally
- **iOS Development** (macOS only):
  - Xcode 14.0+
  - iOS Simulator or physical iOS device
  - Apple Developer Account (for device testing)
- **Android Development**:
  - Android Studio
  - Android SDK (API 31+)
  - Android Emulator or physical device

### Environment Setup

#### macOS (iOS + Android)

```bash
# Install Xcode from App Store
# Install Command Line Tools
xcode-select --install

# Install Homebrew (if not installed)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install Watchman (improves performance)
brew install watchman

# Install Android Studio from https://developer.android.com/studio
# Configure Android SDK through Android Studio
```

#### Linux/Windows (Android only)

```bash
# Install Android Studio
# Download from https://developer.android.com/studio

# Configure ANDROID_HOME environment variable
# Linux/macOS:
export ANDROID_HOME=$HOME/Android/Sdk
export PATH=$PATH:$ANDROID_HOME/emulator
export PATH=$PATH:$ANDROID_HOME/tools
export PATH=$PATH:$ANDROID_HOME/tools/bin
export PATH=$PATH:$ANDROID_HOME/platform-tools

# Windows (PowerShell):
$env:ANDROID_HOME="$HOME\AppData\Local\Android\Sdk"
$env:PATH="$env:PATH;$env:ANDROID_HOME\emulator;$env:ANDROID_HOME\tools;$env:ANDROID_HOME\platform-tools"
```

## Installation

### From Project Root

```bash
# Install all project dependencies (includes mobile)
bun install --frozen-lockfile

# Or install only the mobile workspace
bun install --cwd apps/mobile
```

### Verify Installation

```bash
cd apps/mobile
npx expo --version
# Should output: ~54.0.10
```

## Development

### Start Development Server

From project root:

```bash
# Start Expo dev server
bun run mobile

# Or from mobile directory:
cd apps/mobile
bun run start
```

This opens the Expo Dev Tools in your browser.

### Run on iOS Simulator (macOS only)

```bash
# From project root
bun run mobile:ios

# Or from mobile directory
cd apps/mobile
bun run ios
```

**First Time Setup**:

```bash
# Install iOS Simulator (if not installed)
xcode-select --install
xcrun simctl list devices

# If no simulators, install via Xcode:
# Xcode → Settings → Platforms → iOS → Get
```

### Run on Android Emulator

```bash
# Start Android emulator first (from Android Studio or command line)
emulator -avd Pixel_4_API_31

# Then run the app
# From project root
bun run mobile:android

# Or from mobile directory
cd apps/mobile
bun run android
```

**Create Android Emulator** (if needed):

```bash
# List available system images
sdkmanager --list | grep system-images

# Install system image
sdkmanager "system-images;android-31;google_apis;x86_64"

# Create AVD
avdmanager create avd -n Pixel_4_API_31 -k "system-images;android-31;google_apis;x86_64" --device "pixel_4"
```

### Run on Physical Device

#### iOS Device

1. Install **Expo Go** app from App Store
2. Scan QR code from Expo Dev Tools
3. App loads on device

**For development builds**:

```bash
# Requires Apple Developer Account
eas build --profile development --platform ios
```

#### Android Device

1. Install **Expo Go** app from Google Play
2. Enable USB debugging on device
3. Connect device via USB
4. Run: `bun run mobile:android`

Or scan QR code from Expo Dev Tools in Expo Go app.

### Hot Reloading

Changes to TypeScript/JavaScript files will automatically reload:

- **Fast Refresh**: Preserves component state
- **Full Reload**: Press `r` in terminal or shake device

```bash
# Force reload
# In terminal: press 'r'
# On device: shake device and select "Reload"
```

## Building

### Development Build

```bash
# Install EAS CLI
bun install --global eas-cli

# Login to Expo account
eas login

# Configure project
eas build:configure

# Build for iOS
eas build --profile development --platform ios

# Build for Android
eas build --profile development --platform android
```

### Production Build

#### iOS (requires Apple Developer Account)

```bash
# Build for App Store submission
eas build --profile production --platform ios

# Or build locally (requires Xcode)
cd apps/mobile
npx expo prebuild
# Open ios/mobile.xcworkspace in Xcode
# Archive and upload to App Store Connect
```

#### Android

```bash
# Build AAB for Google Play
eas build --profile production --platform android

# Or build APK locally
cd apps/mobile
npx expo prebuild
cd android
./gradlew assembleRelease

# APK located at: android/app/build/outputs/apk/release/app-release.apk
```

### Build Configuration

Edit `apps/mobile/app.config.ts`:

```ts
// apps/mobile/app.config.ts
export default () => ({
  name: 'TaskForceAI',
  slug: 'taskforceai-mobile',
  version: '1.0.0',
  icon: './assets/icon.png',
  splash: {
    image: './assets/splash.png',
    resizeMode: 'contain',
  },
  ios: {
    bundleIdentifier: 'com.taskforceai.mobile',
    buildNumber: '1',
  },
  android: {
    package: 'com.taskforceai.mobile',
    versionCode: 1,
  },
});
```

## Project Structure

```
mobile/
├── assets/                  # Images, fonts, icons
│   ├── icon.png            # App icon (1024x1024)
│   └── splash.png          # Splash screen
├── src/
│   ├── App.tsx             # Main app component
│   ├── components/         # Mobile-specific components
│   ├── screens/            # Screen components
│   ├── navigation/         # Navigation setup
│   └── styles/             # Mobile styles
├── app.config.ts           # Expo configuration
├── package.json            # Dependencies
├── tsconfig.json           # TypeScript configuration
└── README.md               # This file
```

## Core Architecture

### Data & Offline Sync

- **Drizzle ORM + expo-sqlite** persist conversations, messages, and the pending prompt queue. Update `src/storage/schema.ts` and run `bun run db:generate --cwd apps/mobile` to generate migrations in `apps/mobile/drizzle/`.
- The existing sync manager consumes this layer for offline caching, queued prompts, and reconciliation with the backend.
- **Fuse.js** powers fuzzy search in the sidebar, merging remote API results with local (offline) conversations so users can instantly filter regardless of connectivity.

### Observability

- **Sentry** is initialized in `apps/mobile/src/observability/sentry.ts`, and logs bridge through `apps/mobile/src/logger.ts` so crashes and handled errors reach the same pipeline.

### Monetization

- **RevenueCat** (see `src/billing/revenuecat.ts`) powers iOS/Android subscriptions. Provide the platform keys through `app.config.ts` or EAS env vars before building store binaries.

### Type Safety

- The mobile workspace opts into TypeScript `strict` mode (`apps/mobile/tsconfig.json`). Run `bun run typecheck` at the repo root to ensure types remain sound across packages.

## Shared Code

The mobile app shares code with the web and desktop apps via the `packages/shared-ts` workspace, aliased as `@shared/*`:

```
packages/shared-ts/src/
├── auth/               # Auth helpers + Zod schemas
├── observability/      # Sentry/logging glue
├── support/            # Issue reporting helpers
├── sync/               # Sync-specific helpers
├── types/              # Shared type definitions
└── utils.ts            # Cross-platform utilities
```

- **Runtime validation**: `apps/mobile/src/config/env.ts` mirrors the web env loader and validates Expo runtime configuration with **Zod**. Any new environment variable should be added to the schema so mobile and web fail fast together.
- **Server state**: data-fetching code uses **React Query** with shared API client methods. See `apps/mobile/src/providers/QueryProvider.tsx` plus the hooks under `apps/mobile/src/hooks/api/` for query keys, mutations (e.g., conversations, subscriptions, queued prompts), and cache invalidation policies.

## Styling & Theming

- **Design tokens** live in `packages/design-tokens`. Update `index.js` there and run `bun run --filter @taskforceai/design-tokens build:css` whenever tokens change—the script regenerates the CSS variables consumed by the web app.
- **NativeWind** powers layout/typography utilities. Classes such as `bg-background`, `text-text`, `gap-sm`, and `rounded-lg` map directly to shared tokens (see `apps/mobile/nativewind.config.js`). Prefer `className` for structural styles and drop down to `StyleSheet` only for dynamic values that utilities can’t express (animations, runtime colors, etc.).
- **Liquid-glass components** (`GlassCard`, headers, sidebar chrome) now merge Expo’s blur/tint primitives with tokenized colors and NativeWind spacing. Keep glass-specific logic encapsulated and pair them with utility classes when composing screens.

### Using Shared API Client

```typescript
// In mobile component
import { getBrowserClient } from '@taskforceai/contracts/browserClient';
import { useAuth } from '@taskforceai/contracts/hooks';

function MyComponent() {
  const { user, login, logout } = useAuth();

  const handleLogin = async () => {
    await login('email@example.com', 'password');
  };

  return (
    <View>
      {user ? (
        <Text>Welcome {user.email}</Text>
      ) : (
        <Button onPress={handleLogin} title="Login" />
      )}
    </View>
  );
}
```

### Platform-Specific Code

Use React Native's `Platform` API:

```typescript
import { Platform } from 'react-native';

const styles = StyleSheet.create({
  container: {
    paddingTop: Platform.OS === 'ios' ? 44 : 0, // iOS status bar
  },
});

// Or use .ios.tsx and .android.tsx file extensions
// Component.ios.tsx - iOS-specific
// Component.android.tsx - Android-specific
// Component.tsx - Shared implementation
```

## Platform-Specific Features

### iOS

- **Face ID / Touch ID**: For biometric authentication
- **Push Notifications**: Expo push service (APNs under the hood)
- **Deep Linking**: Custom URL schemes
- **App Extensions**: Share extension, widgets

### Android

- **Fingerprint / Face Unlock**: Biometric authentication
- **Push Notifications**: Expo push service (FCM under the hood)
- **Deep Linking**: Intent filters
- **Widgets**: Home screen widgets

### Push Notifications (Expo)

TaskForceAI Mobile uses [`expo-notifications`](https://docs.expo.dev/versions/latest/sdk/notifications/) to request permissions, fetch Expo push tokens, and surface delivery inside the Settings modal.

- **Enablement:** Open the in-app Settings sheet ➜ toggle `Notifications`. We only flip the preference after iOS/Android grant permission, and the toggle becomes disabled if the OS setting is later revoked.
- **Testing:** Physical hardware is required; Apple/Google simulators cannot receive push payloads. Run `bun run ios`/`android` with a development build or Expo Go on-device, sign in, then toggle notifications to fetch a token.
- **Token storage:** Tokens are cached in AsyncStorage (`@taskforceai:expoPushToken`) and synced to the backend via `/api/v1/notifications/push-tokens` whenever registration succeeds; disabling notifications or logging out unregisters the token automatically.
- **Configuration:** Icons, colors, and foreground presentation are defined in `app.config.ts` via the `notification` block and the `expo-notifications` config plugin. Update those values before shipping new branding.

### Implementing Biometric Auth

```bash
# Install expo-local-authentication
npx expo install expo-local-authentication
```

```typescript
import * as LocalAuthentication from 'expo-local-authentication';

async function authenticate() {
  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  const isEnrolled = await LocalAuthentication.isEnrolledAsync();

  if (hasHardware && isEnrolled) {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Authenticate to continue',
    });
    return result.success;
  }
  return false;
}
```

## Testing

TaskForceAI Mobile relies on **Jest** for fast unit/integration coverage and **Detox** for device-level flows. Both run against the strict TypeScript config, so treat failing tests as release blockers.

### Unit Tests

```
cd apps/mobile
bun run test
```

Unit tests are minimal by design and run through [`tsx`](https://github.com/esbuild-kit/tsx) to validate shared utility helpers without pulling in the full React Native runtime.

### Circular Dependency Scan

Detect Expo/Metro-breaking import cycles before launching the dev server:

```bash
# From the repo root
bun run qa:mobile:cycles
```

The script parses the mobile TypeScript program and fails fast with the exact cycle path if any dependencies loop back on themselves.

### E2E Tests (Detox)

The mobile workspace ships with a basic Detox harness that drives the Expo Router login and signup flows.
Prerequisites: Xcode (for iOS sims), Android Studio (for emulators), an Expo dev client, and an iOS Simulator / Android AVD.

```bash
# iOS simulator
cd apps/mobile
bun run detox:ios:build   # generates the native project (expo prebuild) and compiles the .app
bun run detox:ios:test    # launches the iPhone 15 simulator and runs e2e/onboarding.e2e.js

# Optional iOS screen-size lanes
bunx detox test --config detox.config.js --configuration ios.6_1.debug     # iPhone 15
bunx detox test --config detox.config.js --configuration ios.6_3.debug     # iPhone 16 Pro
bunx detox test --config detox.config.js --configuration ios.6_5.debug     # iPhone 11 Pro Max
bunx detox test --config detox.config.js --configuration ios.6_7.debug     # iPhone 15 Pro Max
bunx detox test --config detox.config.js --configuration ios.6_9.debug     # iPhone 16 Pro Max
bunx detox test --config detox.config.js --configuration ios.tablet.debug  # iPad Air 11-inch

# Android emulator
cd apps/mobile
bun run detox:android:build
bun run detox:android:test
```

The default iOS lane is `ios.sim.debug`, which aliases `ios.6_1.debug` and runs on iPhone 15. The build step triggers `expo prebuild` automatically to ensure the native `ios/` and `android/` directories exist.

### Manual Testing Checklist

- [ ] Login/logout functionality
- [ ] Create and view conversations
- [ ] Multi-agent orchestration
- [ ] Real-time progress updates
- [ ] Offline mode handling
- [ ] Deep linking
- [ ] Push notifications (Expo & backend delivery)
- [ ] Biometric authentication
- [ ] Different screen sizes
- [ ] Landscape/portrait orientation
- [ ] Dark mode support

## Deployment

### Over-the-air updates (EAS Update)

TaskForceAI mobile uses [Expo Application Services (EAS) Update](https://docs.expo.dev/eas-update/introduction/) to deliver fixes between store submissions.

```
# Ship a preview hotfix to internal testers
(cd apps/mobile && bunx eas-cli update --channel preview \
  --message "Fix streaming indicator flicker")

# Promote the latest changes to customers
(cd apps/mobile && bunx eas-cli update --channel production \
  --message "Mobile 0.3.1")
```

- **Channels:** Preview builds subscribe to the `preview` channel; production binaries listen to `production`.
- **Runtime version:** The app uses the `appVersion` policy so OTA updates only apply to compatible binaries.
- **When to rebuild:** Add new native modules or change `app.config`? Run a fresh `eas build` for each platform and submit through the stores.

### iOS App Store

1. **Configure app in App Store Connect**
   - Create app listing
   - Set up pricing and availability
   - Configure App Store information

2. **Build and upload**

   ```bash
   eas build --profile production --platform ios
   # Or use Xcode to archive and upload
   ```

3. **TestFlight Beta Testing**
   - Add internal testers
   - Add external testers (after review)

4. **Submit for Review**
   - Complete app information
   - Submit for App Store review
   - Monitor review status

### Google Play Store

1. **Configure app in Google Play Console**
   - Create app listing
   - Set up store listing
   - Configure pricing and distribution

2. **Build and upload**

   ```bash
   eas build --profile production --platform android
   # Uploads AAB automatically with EAS
   ```

3. **Internal Testing Track**
   - Add internal testers
   - Test thoroughly

4. **Production Release**
   - Promote from internal to production
   - Monitor crash reports and reviews

## Troubleshooting

### Common Issues

#### Metro Bundler Not Starting

```bash
# Clear cache and restart
cd apps/mobile
npx expo start -c
```

#### iOS Build Fails

```bash
# Clean iOS build
cd apps/mobile/ios
pod deintegrate
pod install

# Or with Expo
npx expo prebuild --clean
```

#### Android Build Fails

```bash
# Clean Android build
cd apps/mobile/android
./gradlew clean

# Or with Expo
npx expo prebuild --clean
```

#### Can't Connect to Development Server

1. Ensure device and computer are on same network
2. Check firewall settings
3. Try tunnel mode:
   ```bash
   npx expo start --tunnel
   ```

#### Expo Go Not Working

- Update Expo Go app to latest version
- Use development build instead:
  ```bash
  eas build --profile development --platform ios
  ```

#### Type Errors with Shared Code

```bash
# Ensure TypeScript can find shared modules
# In mobile/tsconfig.json:
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@shared/*": ["../../packages/shared-ts/src/*"]
    }
  }
}
```

### Debug Tools

#### React Native Debugger

```bash
# Install
brew install --cask react-native-debugger

# Enable Debug Mode in app
# Shake device → "Debug" or press Cmd+D (iOS) / Cmd+M (Android)
```

#### Flipper (Meta's debugging tool)

```bash
# Install from https://fbflipper.com/
# Automatically works with React Native apps
```

#### Reactotron

```bash
# Install
cd apps/mobile
bun add -d reactotron-react-native

# Configure in App.tsx
import Reactotron from 'reactotron-react-native';
Reactotron.configure().useReactNative().connect();
```

### Performance Optimization

1. **Enable Hermes Engine** (faster JavaScript execution)

   ```ts
   // apps/mobile/app.config.ts
   export default () => ({
     android: { jsEngine: 'hermes' },
     ios: { jsEngine: 'hermes' },
   });
   ```

2. **Optimize Images**

   ```bash
   # Use optimized image formats
   # iOS: HEIC, WebP
   # Android: WebP
   ```

3. **Code Splitting**
   ```typescript
   // Lazy load heavy components
   const HeavyComponent = React.lazy(() => import('./HeavyComponent'));
   ```

## Related Documentation

- [Main README](../README.md)
- [Shared API Documentation](../packages/shared/README.md)
- [Expo Documentation](https://docs.expo.dev/)
- [React Native Documentation](https://reactnative.dev/)

## Support

For issues specific to the mobile app:

1. Check this README and troubleshooting section
2. Review [Expo Documentation](https://docs.expo.dev/)
3. Check [React Native issues](https://github.com/facebook/react-native/issues)
4. Open an issue on the project repository
