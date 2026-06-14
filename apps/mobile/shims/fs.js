const existsSync = () => false;

const mkdirSync = () => {
  // no-op on mobile
};

const writeFileSync = () => {
  // no-op on mobile
};

const readFileSync = () => {
  throw new Error('fs.readFileSync is not available in this environment');
};

const api = {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
};

module.exports = api;
module.exports.default = api;
