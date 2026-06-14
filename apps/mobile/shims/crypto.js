const Crypto = require('expo-crypto');

const randomUUID = () => {
  // Try native crypto first (usually available in modern RN/Expo versions or shims)
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  // Fallback to expo-crypto synchronous UUID generation
  return Crypto.randomUUID();
};

const api = {
  randomUUID,
};

module.exports = api;
module.exports.default = api;
