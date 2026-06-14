const Module = require('module');
const fs = require('fs');
const path = require('path');

const allowlist = [`${path.sep}nativewind${path.sep}`, `${path.sep}react-native-css${path.sep}`];
const originalLoad = Module._load;

const reactNativeStub = new Proxy(
  {},
  {
    get: (_target, property) => {
      if (property === '__esModule') {
        return true;
      }
      if (property === 'default') {
        return reactNativeStub;
      }
      return reactNativeStub;
    },
  }
);

const patchCompiler = (compiler) => {
  if (!compiler || typeof compiler.compile !== 'function' || compiler.__nativewindPatched) {
    return compiler;
  }
  const originalCompile = compiler.compile;
  compiler.compile = (code, options = {}) => {
    try {
      return originalCompile(code, options);
    } catch (error) {
      try {
        const identifier = options?.filename ? path.basename(options.filename) : 'unknown';
        const outPath = path.join(process.cwd(), `.nativewind-compile-error-${identifier}.css`);
        fs.writeFileSync(outPath, typeof code === 'string' ? code : Buffer.from(code).toString());
        console.warn(`[nativewind-shim] captured failing CSS at ${outPath}`);
      } catch {
        // ignore secondary errors
      }
      throw error;
    }
  };
  compiler.__nativewindPatched = true;
  return compiler;
};

try {
  const compilerPath = require.resolve('react-native-css/compiler');
  const compilerModule = require(compilerPath);
  patchCompiler(compilerModule);
} catch {
  // ignore if module not resolvable yet
}

Module._load = function patchedLoad(request, parent, isMain) {
  if (
    request === 'react-native' &&
    parent?.filename &&
    allowlist.some((segment) => parent.filename.includes(segment))
  ) {
    return reactNativeStub;
  }
  if (
    request === 'react-native-css/compiler' ||
    (request.includes('react-native-css') && request.includes('compiler'))
  ) {
    const compiler = originalLoad.call(this, request, parent, isMain);
    return patchCompiler(compiler);
  }
  return originalLoad.call(this, request, parent, isMain);
};
