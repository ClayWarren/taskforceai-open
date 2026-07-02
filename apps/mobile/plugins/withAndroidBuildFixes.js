const {
  withAndroidManifest,
  withAppBuildGradle,
  withDangerousMod,
  withGradleProperties,
} = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const VOICE_ANDROID_BUILD_GRADLE = path.join(
  'node_modules',
  '@react-native-voice',
  'voice',
  'android',
  'build.gradle'
);

function patchReactNativeVoiceBuildGradle(contents) {
  let next = contents;

  next = next.replace(/^(\s*)jcenter\(\)/gm, '$1google()\n$1mavenCentral()');
  next = next.replace(
    '    compileSdkVersion rootProject.hasProperty(\'compileSdkVersion\') ? rootProject.compileSdkVersion : DEFAULT_COMPILE_SDK_VERSION\n',
    "    namespace 'com.wenkesj.voice'\n    compileSdk rootProject.ext.has('compileSdkVersion') ? rootProject.ext.compileSdkVersion : DEFAULT_COMPILE_SDK_VERSION\n"
  );
  next = next.replace(
    '    buildToolsVersion rootProject.hasProperty(\'buildToolsVersion\') ? rootProject.buildToolsVersion : DEFAULT_BUILD_TOOLS_VERSION\n',
    "    buildToolsVersion rootProject.ext.has('buildToolsVersion') ? rootProject.ext.buildToolsVersion : DEFAULT_BUILD_TOOLS_VERSION\n"
  );
  next = next.replace(
    '        minSdkVersion 15\n',
    "        minSdkVersion rootProject.ext.has('minSdkVersion') ? rootProject.ext.minSdkVersion : 23\n"
  );
  next = next.replace(
    '        targetSdkVersion rootProject.hasProperty(\'targetSdkVersion\') ? rootProject.targetSdkVersion : DEFAULT_TARGET_SDK_VERSION\n',
    "        targetSdkVersion rootProject.ext.has('targetSdkVersion') ? rootProject.ext.targetSdkVersion : DEFAULT_TARGET_SDK_VERSION\n"
  );
  next = next.replace(
    '    implementation "com.android.support:appcompat-v7:${supportVersion}"\n    implementation \'com.facebook.react:react-native:+\'\n',
    "    implementation 'androidx.appcompat:appcompat:1.7.1'\n    implementation 'com.facebook.react:react-android'\n"
  );

  return next;
}

module.exports = function withAndroidBuildFixes(config) {
  // 1. Fix Manifest Merger issues
  config = withAndroidManifest(config, (modConfig) => {
    const androidManifest = modConfig.modResults;

    if (!androidManifest.manifest || !androidManifest.manifest.application) {
      return modConfig;
    }

    const application = androidManifest.manifest.application?.[0];
    if (!application) {
      return modConfig;
    }

    // Explicitly set the attribute we are replacing
    application.$['android:appComponentFactory'] = 'androidx.core.app.CoreComponentFactory';

    // Add tools:replace="android:appComponentFactory" to the application tag
    if (!application.$['tools:replace']) {
      application.$['tools:replace'] = 'android:appComponentFactory';
    } else if (!application.$['tools:replace'].includes('android:appComponentFactory')) {
      application.$['tools:replace'] += ',android:appComponentFactory';
    }

    // Ensure the tools namespace is available
    if (androidManifest.manifest.$ && !androidManifest.manifest.$['xmlns:tools']) {
      androidManifest.manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    }

    return modConfig;
  });

  // 2. Ensure AndroidX and Jetifier are enabled
  config = withGradleProperties(config, async (modConfig) => {
    const properties = modConfig.modResults;
    const updateProperty = (key, value) => {
      const existing = properties.find(p => p.key === key);
      if (existing) {
        existing.value = value;
      } else {
        properties.push({ type: 'property', key, value });
      }
    };

    updateProperty('android.useAndroidX', 'true');
    updateProperty('android.enableJetifier', 'true');
    return modConfig;
  });

  // 3. Force resolution of specific AndroidX libraries to avoid duplicate class errors
  config = withAppBuildGradle(config, async (modConfig) => {
    const buildGradle = modConfig.modResults.contents;

    const resolutionStrategy = `
    configurations.all {
        resolutionStrategy {
            force 'androidx.core:core:1.13.1'
            force 'androidx.versionedparcelable:versionedparcelable:1.1.1'
            
            // Force other common conflicting libraries if needed
            force 'androidx.activity:activity:1.8.0'
            force 'androidx.fragment:fragment:1.6.2'
        }
    }
    `;

    // Append to the android block or at the end
    if (buildGradle.includes('android {')) {
      const insertionPoint = buildGradle.lastIndexOf('}');
      modConfig.modResults.contents = buildGradle.slice(0, insertionPoint) + resolutionStrategy + buildGradle.slice(insertionPoint);
    } else {
      modConfig.modResults.contents += resolutionStrategy;
    }

    return modConfig;
  });

  config = withDangerousMod(config, [
    'android',
    (modConfig) => {
      const voiceBuildGradlePath = path.join(modConfig.modRequest.projectRoot, VOICE_ANDROID_BUILD_GRADLE);

      if (!fs.existsSync(voiceBuildGradlePath)) {
        return modConfig;
      }

      const contents = fs.readFileSync(voiceBuildGradlePath, 'utf8');
      const patched = patchReactNativeVoiceBuildGradle(contents);

      if (patched !== contents) {
        fs.writeFileSync(voiceBuildGradlePath, patched);
      }

      return modConfig;
    },
  ]);

  return config;
};
