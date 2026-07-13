const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const BUILD_SETTINGS_SNIPPET = `
    minimum_ios_deployment_target = podfile_properties['ios.deploymentTarget'] || '17.0'
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |build_configuration|
        build_configuration.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = minimum_ios_deployment_target
      end

      next unless target.name == 'ExpoModulesCore'

      target.build_configurations.each do |build_configuration|
        build_configuration.build_settings['CLANG_WARN_RETURN_TYPE'] = 'NO'
        build_configuration.build_settings['GCC_TREAT_WARNINGS_AS_ERRORS'] = 'NO'
      end

      next unless target.respond_to?(:source_build_phase) && target.source_build_phase

      target.source_build_phase.files.each do |build_file|
        file_name = build_file.file_ref && build_file.file_ref.path
        next unless file_name == 'EXJavaScriptSerializable.mm'

        build_file.settings ||= {}
        compiler_flags = build_file.settings['COMPILER_FLAGS'].to_s.split
        compiler_flags += ['-Wno-error=return-type', '-Wno-return-type']
        build_file.settings['COMPILER_FLAGS'] = compiler_flags.uniq.join(' ')
      end
    end
`;

const EXISTING_BUILD_SETTINGS_PATTERN =
  /\n    (?:minimum_ios_deployment_target = podfile_properties\['ios\.deploymentTarget'\] \|\| '17\.0'\n    )?installer\.pods_project\.targets\.each do \|target\|[\s\S]*?target\.name == 'ExpoModulesCore'[\s\S]*?\n    end\n/;

function withIosExpoModulesCoreBuildFixes(config) {
  return withDangerousMod(config, [
    'ios',
    (modConfig) => {
      const podfilePath = path.join(modConfig.modRequest.platformProjectRoot, 'Podfile');
      const contents = fs.readFileSync(podfilePath, 'utf8');

      if (contents.includes("minimum_ios_deployment_target = podfile_properties['ios.deploymentTarget'] || '17.0'")) {
        return modConfig;
      }

      if (contents.includes("target.name == 'ExpoModulesCore'")) {
        fs.writeFileSync(podfilePath, contents.replace(EXISTING_BUILD_SETTINGS_PATTERN, BUILD_SETTINGS_SNIPPET));
        return modConfig;
      }

      const marker = `    react_native_post_install(
      installer,
      config[:reactNativePath],
      :mac_catalyst_enabled => false,
      :ccache_enabled => ccache_enabled?(podfile_properties),
    )
`;

      if (!contents.includes(marker)) {
        throw new Error(
          '[withIosExpoModulesCoreBuildFixes] Unable to find react_native_post_install block in ios/Podfile'
        );
      }

      fs.writeFileSync(podfilePath, contents.replace(marker, `${marker}${BUILD_SETTINGS_SNIPPET}`));
      return modConfig;
    },
  ]);
}

module.exports = withIosExpoModulesCoreBuildFixes;
