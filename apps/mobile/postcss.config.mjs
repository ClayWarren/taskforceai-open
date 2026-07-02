import valueParser from 'postcss-value-parser';
const debugLog = (...args) => {
  if (process.env.METRO_CONFIG_DEBUG === '1') {
    process.stdout.write(`${args.map(String).join(' ')}\n`);
  }
};

const themeVariableStore = new Map();
const tailwindDefaultVars = new Map([
  ['--tw-border-style', 'solid'],
  ['--tw-translate-x', '0px'],
  ['--tw-translate-y', '0px'],
  ['--tw-translate-z', '0px'],
  ['--tw-inset-shadow', '0 0 #0000'],
  ['--tw-inset-ring-shadow', '0 0 #0000'],
  ['--tw-ring-offset-shadow', '0 0 #0000'],
  ['--tw-ring-shadow', '0 0 #0000'],
  ['--tw-shadow', '0 0 #0000'],
  ['--tw-shadow-colored', '0 0 #0000'],
  ['--tw-shadow-color', 'rgb(0 0 0 / 0.1)'],
]);

const collectThemeVariablesPlugin = () => ({
  postcssPlugin: 'collect-theme-variables',
  Rule(rule) {
    if (!rule.selector || (rule.selector.indexOf(':root') === -1 && rule.selector.indexOf(':host') === -1)) {
      return;
    }
    rule.each((child) => {
      if (child.type === 'decl' && child.prop?.startsWith('--')) {
        themeVariableStore.set(child.prop, child.value);
      }
    });
  },
});
collectThemeVariablesPlugin.postcss = true;

const removeBareLayerPlugin = () => ({
  postcssPlugin: 'remove-bare-layer',
  AtRule(atRule) {
    if (atRule.name === 'layer' && (!atRule.nodes || atRule.nodes.length === 0)) {
      atRule.remove();
    }
  },
});
removeBareLayerPlugin.postcss = true;

const collapseDefaultVarPlugin = () => ({
  postcssPlugin: 'collapse-default-var',
  Declaration(decl) {
    if (!decl.value || decl.value.indexOf('var(--default-') === -1) {
      return;
    }
    decl.value = decl.value.replace(/var\(--default-[\w-]+,\s*([^()]+?)\)/g, '$1');
  },
});
collapseDefaultVarPlugin.postcss = true;

const getLocalVarMap = (parent) => {
  if (!parent || typeof parent.each !== 'function') {
    return undefined;
  }
  if (parent.__twVarMap) {
    return parent.__twVarMap;
  }
  const map = new Map();
  parent.each((child) => {
    if (child.type === 'decl' && child.prop?.startsWith('--tw-')) {
      map.set(child.prop, child.value);
    }
  });
  Object.defineProperty(parent, '__twVarMap', { value: map, enumerable: false });
  return map;
};

const replaceVarFunctions = (value, localVars, seen = new Set()) => {
  if (!value || value.indexOf('var(') === -1) {
    return null;
  }
  const ast = valueParser(value);
  let mutated = false;
  ast.walk((node) => {
    if (node.type !== 'function' || node.value !== 'var') {
      return;
    }
    const nodes = node.nodes;
    if (!nodes?.length) {
      return;
    }
    const nameNode = nodes.find((entry) => entry.type === 'word');
    if (!nameNode) {
      return;
    }
    const commaIndex = nodes.findIndex((entry) => entry.type === 'div' && entry.value === ',');
    const fallback =
      commaIndex === -1 ? undefined : valueParser.stringify(nodes.slice(commaIndex + 1)).trim();
    const resolvedValue = resolveCssVar(nameNode.value, localVars, new Set(seen));
    const finalValue = resolvedValue ?? fallback;
    if (finalValue === undefined || finalValue === null) {
      return;
    }
    mutated = true;
    const nested = replaceVarFunctions(finalValue, localVars, new Set(seen));
    debugLog('[inlineTailwindVarsPlugin] var', nameNode.value, '=>', nested ?? finalValue);
    node.type = 'word';
    node.value = nested ?? finalValue;
    node.nodes = [];
  });
  return mutated ? valueParser.stringify(ast) : null;
};

const resolveCssVar = (rawName, localVars, seen = new Set()) => {
  const propName = rawName.startsWith('--') ? rawName : `--${rawName}`;
  if (seen.has(propName)) {
    return undefined;
  }
  seen.add(propName);
  const candidate =
    (localVars?.get(propName)) ??
    themeVariableStore.get(propName) ??
    tailwindDefaultVars.get(propName);
  if (candidate === undefined || candidate === null) {
    return undefined;
  }
  return replaceVarFunctions(candidate, localVars, new Set(seen)) ?? candidate;
};

const inlineTailwindVarsPlugin = () => ({
  postcssPlugin: 'inline-tailwind-vars',
  Declaration(decl) {
    if (!decl.value || decl.value.indexOf('var(') === -1) {
      return;
    }
    const localVars = getLocalVarMap(decl.parent);
    const nextValue = replaceVarFunctions(decl.value, localVars);
    if (!nextValue) {
      return;
    }
    debugLog('[inlineTailwindVarsPlugin] replaced vars in', decl.prop);
    decl.value = nextValue;
    if (decl.prop?.startsWith('--tw-') && localVars) {
      localVars.set(decl.prop, decl.value);
    }
  },
});
inlineTailwindVarsPlugin.postcss = true;

const normalizeSlashSelectorPlugin = () => ({
  postcssPlugin: 'normalize-slash-selector',
  Rule(rule) {
    if (!rule.selector || !rule.selector.includes('\\/')) {
      return;
    }
    rule.selector = rule.selector.replace(/\\\//g, '\\\\00002f');
  },
});
normalizeSlashSelectorPlugin.postcss = true;

const parseHexColor = (value) => {
  if (!value || !value.startsWith('#')) {
    return null;
  }
  const hex = value.slice(1).trim();
  if (hex.length === 3) {
    const r = parseInt(hex[0] + hex[0], 16);
    const g = parseInt(hex[1] + hex[1], 16);
    const b = parseInt(hex[2] + hex[2], 16);
    return Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b) ? null : { r, g, b };
  }
  if (hex.length === 6) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b) ? null : { r, g, b };
  }
  return null;
};

const formatAlpha = (value) => {
  const clamped = Math.min(1, Math.max(0, value));
  const rounded = Math.round(clamped * 1000) / 1000;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
};

const rewriteColorMixPlugin = () => ({
  postcssPlugin: 'rewrite-color-mix',
  Declaration(decl) {
    if (!decl.value || decl.value.indexOf('color-mix(') === -1) {
      return;
    }
    let updated = decl.value;
    updated = updated.replace(
      /color-mix\(\s*in\s+srgb\s*,\s*([^,]+?)\s+([0-9.]+)%\s*,\s*transparent\s*\)/gi,
      (match, colorToken, percentToken) => {
        const rgb = parseHexColor(colorToken.trim());
        if (!rgb) {
          return match;
        }
        const percent = Number(percentToken);
        if (Number.isNaN(percent)) {
          return match;
        }
        const alpha = formatAlpha(percent / 100);
        return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
      }
    );
    if (updated !== decl.value) {
      decl.value = updated;
    }
  },
});
rewriteColorMixPlugin.postcss = true;

const stripColorMixSupportsPlugin = () => ({
  postcssPlugin: 'strip-color-mix-supports',
  AtRule(atRule) {
    if (atRule.name === 'supports' && atRule.params?.includes('color-mix')) {
      atRule.remove();
    }
  },
});
stripColorMixSupportsPlugin.postcss = true;

const normalizeFilterPlugin = () => ({
  postcssPlugin: 'normalize-filter-declarations',
  Declaration(decl) {
    if (decl.prop !== 'filter') {
      return;
    }
    const collapsed = decl.value?.replace(/\s+/g, ' ').trim();
    if (!collapsed) {
      decl.value = 'none';
      return;
    }
    if (/^(none|initial)(\s+(none|initial))*$/i.test(collapsed)) {
      decl.value = 'none';
    }
  },
});
normalizeFilterPlugin.postcss = true;

const rewriteTranslatePlugin = () => ({
  postcssPlugin: 'rewrite-translate-props',
  Rule(rule) {
    const translateVars = {
      x: undefined,
      y: undefined,
      z: undefined,
    };

    rule.each((child) => {
      if (child.type !== 'decl') {
        return;
      }
      if (child.prop === '--tw-translate-x') {
        translateVars.x = child.value;
      } else if (child.prop === '--tw-translate-y') {
        translateVars.y = child.value;
      } else if (child.prop === '--tw-translate-z') {
        translateVars.z = child.value;
      }
    });

    rule.each((child) => {
      if (child.type !== 'decl') {
        return;
      }
      if (child.prop === 'translate') {
        const parsed = valueParser(child.value);
        const components = [];
        parsed.nodes.forEach((node) => {
          if (node.type === 'space' || node.type === 'comment') {
            return;
          }
          components.push(valueParser.stringify(node));
        });
        const resolveValue = (value, axis) => {
          const defaultKey =
            axis === 'x'
              ? '--tw-translate-x'
              : axis === 'y'
                ? '--tw-translate-y'
                : '--tw-translate-z';
          const defaultValue = tailwindDefaultVars.get(defaultKey) ?? '0px';
          if (!value) {
            return translateVars[axis] ?? defaultValue;
          }
          if (value.includes(`var(--tw-translate-${axis})`)) {
            return translateVars[axis] ?? defaultValue;
          }
          return value;
        };

        const xVal = resolveValue(components[0], 'x');
        const yVal = resolveValue(components[1], 'y');
        const zVal = resolveValue(components[2], 'z');

        if (xVal !== undefined) {
          child.cloneBefore({ prop: 'translateX', value: xVal });
        }
        if (yVal !== undefined) {
          child.cloneBefore({ prop: 'translateY', value: yVal });
        }
        if (zVal !== undefined) {
          child.cloneBefore({ prop: 'translateZ', value: zVal });
        }
        child.remove();
      } else if (child.prop === 'translateX' && child.value.includes('var(--tw-translate-x)')) {
        child.value = translateVars.x ?? tailwindDefaultVars.get('--tw-translate-x') ?? '0px';
      } else if (child.prop === 'translateY' && child.value.includes('var(--tw-translate-y)')) {
        child.value = translateVars.y ?? tailwindDefaultVars.get('--tw-translate-y') ?? '0px';
      } else if (child.prop === 'translateZ' && child.value.includes('var(--tw-translate-z)')) {
        child.value = translateVars.z ?? tailwindDefaultVars.get('--tw-translate-z') ?? '0px';
      }
    });
  },
});
rewriteTranslatePlugin.postcss = true;

const sanitizeInfinityPlugin = () => ({
  postcssPlugin: 'sanitize-infinity-calc',
  Declaration(decl) {
    if (!decl.value || decl.value.indexOf('infinity') === -1) {
      return;
    }
    decl.value = decl.value.replace(/calc\(\s*(-)?infinity\s*\*\s*1px\s*\)/g, (_, negative) =>
      negative ? '-9999px' : '9999px'
    );
  },
});
sanitizeInfinityPlugin.postcss = true;

const removePropertyAtRulesPlugin = () => ({
  postcssPlugin: 'remove-property-atrules',
  AtRule(atRule) {
    if (atRule.name === 'property') {
      atRule.remove();
    }
  },
});
removePropertyAtRulesPlugin.postcss = true;

export default {
  plugins: [
    [
      '@tailwindcss/postcss',
      {
        config: './nativewind.config.js',
      },
    ],
    collectThemeVariablesPlugin,
    removeBareLayerPlugin,
    collapseDefaultVarPlugin,
    inlineTailwindVarsPlugin,
    rewriteColorMixPlugin,
    stripColorMixSupportsPlugin,
    normalizeFilterPlugin,
    normalizeSlashSelectorPlugin,
    rewriteTranslatePlugin,
    sanitizeInfinityPlugin,
    removePropertyAtRulesPlugin,
  ],
};
