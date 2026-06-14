const normalizeParts = (parts, allowAboveRoot) => {
  const resolved = [];
  for (const part of parts) {
    if (!part || part === '.') {
      continue;
    }
    if (part === '..') {
      if (resolved.length > 0 && resolved[resolved.length - 1] !== '..') {
        resolved.pop();
      } else if (allowAboveRoot) {
        resolved.push('..');
      }
      continue;
    }
    resolved.push(part);
  }
  return resolved;
};

const splitPath = (path) => String(path).split('/').filter(Boolean);

const normalizePath = (path, allowAboveRoot = false) => {
  const input = String(path);
  const absolute = input.startsWith('/');
  const normalized = normalizeParts(splitPath(input), allowAboveRoot && !absolute).join('/');
  if (absolute) {
    return `/${normalized}`;
  }
  return normalized || '.';
};

const dirname = (path) => {
  const input = String(path);
  if (input === '') {
    return '.';
  }
  const normalized = normalizePath(input);
  if (normalized === '/' || normalized === '.') {
    return normalized;
  }
  const withoutTrailingSlash = normalized.replace(/\/+$/, '');
  const index = withoutTrailingSlash.lastIndexOf('/');
  if (index === -1) {
    return '.';
  }
  if (index === 0) {
    return '/';
  }
  return withoutTrailingSlash.slice(0, index);
};

const resolve = (...parts) => {
  let resolved = '';
  for (const part of parts) {
    const value = String(part);
    if (value === '') {
      continue;
    }
    if (value.startsWith('/')) {
      resolved = value;
    } else {
      resolved = resolved ? `${resolved}/${value}` : value;
    }
  }
  return normalizePath(resolved || '.', false);
};

const join = (...parts) => normalizePath(parts.filter((part) => String(part) !== '').join('/'), true);

const api = {
  dirname,
  resolve,
  join,
};

module.exports = api;
module.exports.default = api;
