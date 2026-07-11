import 'dotenv/config';

const PROJECT_ID = 'd3d4de68-fc30-4ede-83e4-e44e7f57085e';
const TASKFORCE_SCHEME = 'taskforceai';

const resolveEnv = (key, fallback) => process.env[key] ?? fallback;

const googleClientIdToScheme = (clientId) =>
  `com.googleusercontent.apps.${clientId.replace('.apps.googleusercontent.com', '')}`;

export default ({ config }) => {
  const iosRevenueCatKey = resolveEnv('REVENUECAT_IOS_API_KEY', '');
  const androidRevenueCatKey = resolveEnv('REVENUECAT_ANDROID_API_KEY', '');
  const androidGoogleClientId = resolveEnv('EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID', '');
  const iosGoogleClientId = resolveEnv('EXPO_PUBLIC_GOOGLE_CLIENT_ID', '');
  const iosUrlTypes = [
    { CFBundleURLSchemes: [TASKFORCE_SCHEME] },
    ...(iosGoogleClientId
      ? [{ CFBundleURLSchemes: [googleClientIdToScheme(iosGoogleClientId)] }]
      : []),
  ];
  const androidIntentFilters = [
    {
      action: 'VIEW',
      data: [{ scheme: TASKFORCE_SCHEME }],
      category: ['BROWSABLE', 'DEFAULT'],
    },
    ...(androidGoogleClientId
      ? [
          {
            action: 'VIEW',
            data: [{ scheme: googleClientIdToScheme(androidGoogleClientId) }],
            category: ['BROWSABLE', 'DEFAULT'],
          },
        ]
      : []),
  ];

  return {
    ...config,
    name: 'TaskForceAI',
    slug: 'taskforceai-mobile',
    scheme: TASKFORCE_SCHEME,
    version: '0.6.0',
    orientation: 'default',
    icon: './assets/icon.png',
    userInterfaceStyle: 'dark',
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.taskforceai.mobile',
      buildNumber: '42',
      infoPlist: {
        UIUserInterfaceStyle: 'Dark',
        ITSAppUsesNonExemptEncryption: false,
        NSUserNotificationUsageDescription:
          'TaskForceAI uses notifications to alert you when automations start, finish, or need your attention.',
        NSSpeechRecognitionUsageDescription:
          'TaskForceAI uses speech recognition to transcribe your voice commands for the AI assistant.',
        NSMicrophoneUsageDescription:
          'TaskForceAI uses the microphone to record your voice commands for the AI assistant.',
        NSCameraUsageDescription:
          'TaskForceAI needs camera access so you can take photos and attach them directly to your AI conversations.',
        NSPhotoLibraryUsageDescription:
          'TaskForceAI needs photo library access so you can select images to share with your AI assistant for visual analysis.',
        CFBundleURLTypes: iosUrlTypes,
      },
    },
    android: {
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#05060f',
      },
      package: 'com.taskforceai.mobile',
      versionCode: 26,
      intentFilters: androidIntentFilters,
    },
    web: {
      favicon: './assets/favicon.png',
    },
    experiments: {
      typedRoutes: true,
    },
    plugins: [
      './plugins/withIosExpoModulesCoreBuildFixes.js',
      './plugins/withAndroidBuildFixes.js',
      './plugins/withCertificatePinning.js',
      [
        'expo-splash-screen',
        {
          image: './assets/splash-icon.png',
          resizeMode: 'contain',
          backgroundColor: '#05060f',
        },
      ],
      [
        '@sentry/react-native',
        {
          organization: 'taskforceai',
          project: 'mobile',
        },
      ],
      [
        'expo-build-properties',
        {
          ios: {
            useFrameworks: 'static',
            deploymentTarget: '17.0',
          },
          android: {
            enableJetifier: true,
          },
        },
      ],
      'expo-font',
      'expo-secure-store',
      [
        'expo-speech-recognition',
        {
          microphonePermission:
            'TaskForceAI uses the microphone to record your voice commands for the AI assistant.',
          speechRecognitionPermission:
            'TaskForceAI uses speech recognition to transcribe your voice commands for the AI assistant.',
          androidSpeechServicePackages: ['com.google.android.googlequicksearchbox'],
        },
      ],
      'expo-router',
      'expo-apple-authentication',
      [
        'expo-notifications',
        {
          icon: './assets/icon.png',
          color: '#818cf8',
          androidMode: 'default',
          androidCollapsedTitle: 'TaskForceAI',
        },
      ],
      [
        'expo-sqlite',
        {
          useSQLCipher: true,
        },
      ],
    ],
    extra: {
      ...config.extra,
      eas: {
        projectId: PROJECT_ID,
      },
      billing: {
        revenueCatIosApiKey: iosRevenueCatKey,
        revenueCatAndroidApiKey: androidRevenueCatKey,
        entitlementPro: resolveEnv('REVENUECAT_ENTITLEMENT_PRO', 'pro'),
        entitlementSuper: resolveEnv('REVENUECAT_ENTITLEMENT_SUPER', 'super'),
        appStoreProductIdPro: resolveEnv('APP_STORE_PRO_PRODUCT_ID', 'com.taskforceai.pro'),
        appStoreProductIdSuper: resolveEnv('APP_STORE_SUPER_PRODUCT_ID', 'com.taskforceai.super'),
        playStoreProductIdPro: resolveEnv('PLAY_STORE_PRO_PRODUCT_ID', 'pro_plan'),
        playStoreProductIdSuper: resolveEnv('PLAY_STORE_SUPER_PRODUCT_ID', 'super_plan'),
      },
    },
    owner: 'claywarren',
    runtimeVersion: {
      policy: 'appVersion',
    },
    updates: {
      url: `https://u.expo.dev/${PROJECT_ID}`,
    },
  };
};
