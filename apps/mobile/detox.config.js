const path = require('path');
const { execFileSync } = require('child_process');

const projectRoot = __dirname;
const iosBuildDir = path.join(projectRoot, 'ios', 'build');
const iosDeviceName = process.env.TASKFORCEAI_DETOX_IOS_DEVICE_NAME ?? 'TaskForceAI-iPhone16';
const iosDeviceUdid = process.env.TASKFORCEAI_DETOX_IOS_DEVICE_UDID ?? '';
const iosDestination = iosDeviceUdid
  ? `id=${iosDeviceUdid}`
  : `platform=iOS Simulator,name=${iosDeviceName}`;
const iosDetoxBuildEnv = [
  'SENTRY_DISABLE_AUTO_UPLOAD=true',
  'SENTRY_COPY_OPTIONS_FILE=false',
  'EXPO_PUBLIC_DISABLE_E2E_SYNC=1',
  'EXPO_PUBLIC_ENABLE_E2E_AUTH_SEED=0',
  'EXPO_PUBLIC_E2E_CHAT_ORDER_FIXTURE=false',
].join(' ');
const resolveIosDefaultDevice = () => {
  if (iosDeviceUdid) {
    return { id: iosDeviceUdid };
  }

  if (process.env.TASKFORCEAI_DETOX_IOS_6_1_UDID) {
    return { id: process.env.TASKFORCEAI_DETOX_IOS_6_1_UDID };
  }

  try {
    const raw = execFileSync('xcrun', ['simctl', 'list', 'devices', 'available', '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const devicesByRuntime = JSON.parse(raw).devices ?? {};
    for (const devices of Object.values(devicesByRuntime)) {
      const device = Array.isArray(devices)
        ? devices.find((candidate) => candidate.name === 'TaskForceAI-iPhone16')
        : null;
      if (device?.udid) {
        return { id: device.udid };
      }
    }
  } catch {
    // Fall back to a reusable device type when simctl is unavailable in CI setup.
  }

  return { type: 'iPhone 16' };
};
const iosDefaultDevice = resolveIosDefaultDevice();
const iosXcodeBuild = (configuration) =>
  [
    iosDetoxBuildEnv,
    'xcodebuild',
    '-workspace ios/TaskForceAI.xcworkspace',
    '-scheme TaskForceAI',
    `-configuration ${configuration}`,
    '-sdk iphonesimulator',
    `-destination "${iosDestination}"`,
    `-derivedDataPath ${iosBuildDir}`,
    'ONLY_ACTIVE_ARCH=YES',
  ].join(' ');

/** @type {import('detox').DetoxConfig} */
module.exports = {
  testRunner: {
    args: {
      $0: 'jest',
      config: path.join(projectRoot, 'e2e', 'jest.config.cjs'),
    },
    jest: {
      setupTimeout: 120000,
    },
  },
  apps: {
    'ios.debug': {
      type: 'ios.app',
      binaryPath: path.join(
        projectRoot,
        'ios',
        'build',
        'Build',
        'Products',
        'Debug-iphonesimulator',
        'TaskForceAI.app'
      ),
      build: iosXcodeBuild('Debug'),
    },
    'ios.release': {
      type: 'ios.app',
      binaryPath: path.join(
        projectRoot,
        'ios',
        'build',
        'Build',
        'Products',
        'Release-iphonesimulator',
        'TaskForceAI.app'
      ),
      build: iosXcodeBuild('Release'),
    },
    'android.debug': {
      type: 'android.apk',
      binaryPath: path.join(
        projectRoot,
        'android',
        'app',
        'build',
        'outputs',
        'apk',
        'debug',
        'app-debug.apk'
      ),
      build: [
        'bunx expo prebuild --platform android --non-interactive',
        'cd android',
        './gradlew assembleDebug assembleAndroidTest -DtestBuildType=debug',
      ].join(' && '),
      testBinaryPath: path.join(
        projectRoot,
        'android',
        'app',
        'build',
        'outputs',
        'apk',
        'androidTest',
        'debug',
        'app-debug-androidTest.apk'
      ),
    },
  },
  devices: {
    'ios.6_1': {
      type: 'ios.simulator',
      device: iosDefaultDevice,
    },
    'ios.6_3': {
      type: 'ios.simulator',
      device: {
        type: 'iPhone 17 Pro',
      },
    },
    'ios.6_5': {
      type: 'ios.simulator',
      device: {
        type: 'iPhone 17',
      },
    },
    'ios.6_7': {
      type: 'ios.simulator',
      device: {
        type: 'iPhone 16 Plus',
      },
    },
    'ios.6_9': {
      type: 'ios.simulator',
      device: {
        type: 'iPhone 17 Pro Max',
      },
    },
    'ios.tablet': {
      type: 'ios.simulator',
      device: {
        type: 'iPad Air 11-inch (M4)',
      },
    },
    emulator: {
      type: 'android.emulator',
      device: {
        avdName: 'Pixel_6_API_34',
      },
    },
  },
  configurations: {
    'ios.6_1.debug': {
      device: 'ios.6_1',
      app: 'ios.debug',
    },
    'ios.6_3.debug': {
      device: 'ios.6_3',
      app: 'ios.debug',
    },
    'ios.6_5.debug': {
      device: 'ios.6_5',
      app: 'ios.debug',
    },
    'ios.6_7.debug': {
      device: 'ios.6_7',
      app: 'ios.debug',
    },
    'ios.6_9.debug': {
      device: 'ios.6_9',
      app: 'ios.debug',
    },
    'ios.sim.debug': {
      device: 'ios.6_1',
      app: 'ios.debug',
    },
    'ios.sim.release': {
      device: 'ios.6_1',
      app: 'ios.release',
    },
    'ios.tablet.debug': {
      device: 'ios.tablet',
      app: 'ios.debug',
    },
    'android.emu.debug': {
      device: 'emulator',
      app: 'android.debug',
    },
  },
};
