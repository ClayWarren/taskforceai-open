/**
 * EX-M3: Expo Config Plugin — Native Certificate Pinning
 *
 * This plugin configures OS-level TLS certificate pinning for both iOS and
 * Android so that the native networking stack rejects connections whose
 * certificate chain does not include the expected SPKI public key hashes.
 *
 * iOS:  Adds NSPinnedDomains under NSAppTransportSecurity in Info.plist.
 *       Supported on iOS 14+ / macOS 11+.
 *
 * Android: Writes a network_security_config.xml and references it in
 *          AndroidManifest.xml. Supported on Android 7.0+ (API 24+).
 *
 * Pin hashes are kept in sync with src/security/certificate-pinning.ts.
 * When you rotate certificates, update BOTH this file and the TS module.
 */

const {
  withInfoPlist,
  withAndroidManifest,
} = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

// ─── Pin Configuration (keep in sync with certificate-pinning.ts) ────────────

const PINNED_DOMAINS = ['api.taskforceai.chat', 'www.taskforceai.chat'];

const LEAF_SPKI_HASHES = [
  // Primary: leaf certificate SPKI hash
  'RLuFVJ2V0Ew4coFgR1qyDIZBKailpT7NSkvYYIrcVJg=',
  // Previous leaf pin kept as a short-term backup during certificate rotation
  'uXLQYJd7UiK0Qgwd8SSOG3raaD1SHQdD4OmSpAlYsgQ=',
];

const CA_SPKI_HASHES = [
  // Backup: intermediate CA
  'kZwN96eHtZftBWrOZUsd6cA4es80n3NzSk/XtYz2EqQ=',
];

const SPKI_HASHES = [...LEAF_SPKI_HASHES, ...CA_SPKI_HASHES];
const IOS_PINNED_HASHES = CA_SPKI_HASHES;
const DEBUG_SOURCE_SETS = ['debug', 'debugOptimized'];

const PLACEHOLDER_HASHES = new Set([
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=',
]);

function isPlaceholderHash(hash) {
  const trimmed = String(hash).trim();
  if (PLACEHOLDER_HASHES.has(trimmed)) return true;
  const unpadded = trimmed.replace(/=+$/g, '');
  return /^([A])\1+$/.test(unpadded) || /^([B])\1+$/.test(unpadded);
}

function shouldEnforceProductionPinValidation() {
  const buildProfile = String(process.env.EAS_BUILD_PROFILE || '').toLowerCase();
  const appEnv = String(
    process.env.APP_ENV ||
    process.env.EXPO_PUBLIC_APP_ENV ||
    ''
  ).toLowerCase();
  const nodeEnv = String(process.env.NODE_ENV || '').toLowerCase();

  return buildProfile === 'production' || appEnv === 'production' || nodeEnv === 'production';
}

function assertNoPlaceholderPinsForProduction() {
  if (!shouldEnforceProductionPinValidation()) return;

  const hasPlaceholderPin = SPKI_HASHES.some((hash) => isPlaceholderHash(hash));
  if (!hasPlaceholderPin) return;

  throw new Error(
    '[CertificatePinning] Production build blocked: placeholder SPKI hashes are configured in withCertificatePinning.js. Update pin values before shipping.'
  );
}

// ─── iOS: NSPinnedDomains ────────────────────────────────────────────────────

function withIosCertificatePinning(config) {
  return withInfoPlist(config, (mod) => {
    const plist = mod.modResults;

    if (!plist.NSAppTransportSecurity) {
      plist.NSAppTransportSecurity = {};
    }

    const ats = plist.NSAppTransportSecurity;
    if (!ats.NSPinnedDomains) {
      ats.NSPinnedDomains = {};
    }

    for (const domain of PINNED_DOMAINS) {
      ats.NSPinnedDomains[domain] = {
        NSIncludesSubdomains: true,
        NSPinnedCAIdentities: IOS_PINNED_HASHES.map((hash) => ({
          'SPKI-SHA256-BASE64': hash,
        })),
      };
    }

    return mod;
  });
}

// ─── Android: network_security_config.xml ────────────────────────────────────

function buildNetworkSecurityConfig() {
  const pinEntries = SPKI_HASHES.map(
    (hash) => `            <pin digest="SHA-256">${hash}</pin>`
  ).join('\n');

  const domainEntries = PINNED_DOMAINS.map(
    (domain) => `        <domain includeSubdomains="true">${domain}</domain>`
  ).join('\n');

  return `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <debug-overrides>
        <trust-anchors>
            <certificates src="system" />
            <certificates src="user" />
        </trust-anchors>
    </debug-overrides>

    <!-- Pin production API domains -->
    <domain-config cleartextTrafficPermitted="false">
${domainEntries}
        <pin-set expiration="2027-01-01">
${pinEntries}
        </pin-set>
    </domain-config>

    <!-- Default: trust only system CAs, no cleartext -->
    <base-config cleartextTrafficPermitted="false">
        <trust-anchors>
            <certificates src="system" />
        </trust-anchors>
    </base-config>
</network-security-config>
`;
}

function buildDebugNetworkSecurityConfig() {
  return `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <!-- Debug builds may target local HTTP dev servers and user-installed CAs. -->
    <base-config cleartextTrafficPermitted="true">
        <trust-anchors>
            <certificates src="system" />
            <certificates src="user" />
        </trust-anchors>
    </base-config>
</network-security-config>
`;
}

function writeNetworkSecurityConfig(platformProjectRoot, sourceSet, xml) {
  const resXmlDir = path.join(
    platformProjectRoot,
    'app',
    'src',
    sourceSet,
    'res',
    'xml'
  );

  fs.mkdirSync(resXmlDir, { recursive: true });
  fs.writeFileSync(path.join(resXmlDir, 'network_security_config.xml'), xml, 'utf-8');
}

function withAndroidCertificatePinning(config) {
  // Step 1: Write the XML file during prebuild
  config = withAndroidManifest(config, (mod) => {
    writeNetworkSecurityConfig(
      mod.modRequest.platformProjectRoot,
      'main',
      buildNetworkSecurityConfig()
    );
    for (const sourceSet of DEBUG_SOURCE_SETS) {
      writeNetworkSecurityConfig(
        mod.modRequest.platformProjectRoot,
        sourceSet,
        buildDebugNetworkSecurityConfig()
      );
    }

    // Step 2: Reference the config in AndroidManifest.xml
    const manifest = mod.modResults;
    const application = manifest.manifest.application?.[0];
    if (application) {
      application.$['android:networkSecurityConfig'] =
        '@xml/network_security_config';
    }

    return mod;
  });

  return config;
}

// ─── Main Plugin ─────────────────────────────────────────────────────────────

function withCertificatePinning(config) {
  assertNoPlaceholderPinsForProduction();
  config = withIosCertificatePinning(config);
  config = withAndroidCertificatePinning(config);
  return config;
}

withCertificatePinning.__internal = {
  LEAF_SPKI_HASHES,
  CA_SPKI_HASHES,
  IOS_PINNED_HASHES,
  buildNetworkSecurityConfig,
  buildDebugNetworkSecurityConfig,
  isPlaceholderHash,
  shouldEnforceProductionPinValidation,
  assertNoPlaceholderPinsForProduction,
  withIosCertificatePinning,
};

module.exports = withCertificatePinning;
