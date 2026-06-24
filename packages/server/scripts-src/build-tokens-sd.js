/**
 * Style Dictionary build — scaffolded by Token Flow Manager.
 *
 * Fully driven by `token-config.json` at the project root. Paths are resolved
 * relative to that root, so this script can live anywhere. Adjust freely — your
 * project owns this file.
 */
const StyleDictionary = require('style-dictionary');
const fs = require('fs');
const path = require('path');

// -----------------------------------------------------------------------
// LOAD CONFIGURATION
// -----------------------------------------------------------------------
function findRoot(dir) {
  let d = dir;
  while (!fs.existsSync(path.join(d, 'token-config.json')) && path.dirname(d) !== d) d = path.dirname(d);
  return d;
}
const ROOT = findRoot(__dirname);
const configPath = path.join(ROOT, 'token-config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const USE_CSS_VARIABLES = config.output.useCssVariables;
const EXPORT_PREFIX = config.output.exportPrefix || 'theme';
const THEME_MODE = config.themeMode.mode;
const DEFAULT_THEME = config.themeMode.defaultTheme;
const LIGHT_SELECTOR = config.themeMode.lightSelector;
const DARK_SELECTOR = config.themeMode.darkSelector;
const THEMES = config.themes;
const OUTPUT_DIR = path.join(ROOT, config.output.buildPath || 'src/styles/generated/');
const TEMP_DIR = config.structure.tempDirectory || '.temp-tokens';
const FILE_HEADER = config.comments.fileHeader;
const SOURCE_ROOT = path.join(ROOT, (config.structure && config.structure.sourceRoot) || 'src/design-tokens');
const PRESET_OUTPUT = path.join(
  ROOT,
  (config.structure && config.structure.presetOutputPath) || ('src/app/core/theme/' + EXPORT_PREFIX + '-preset/tokens'),
);

// -----------------------------------------------------------------------
// 1. HELPERS, FORMATS & TRANSFORMS
// -----------------------------------------------------------------------
function wrapPrimitivesIfNeeded(tokens) {
  const cleanTokens = filterMetadata(tokens);
  if (cleanTokens.primitive) return cleanTokens;
  const hasColorKeys = ['primary', 'secondary', 'green', 'orange', 'red', 'grey', 'white', 'black', 'transparent'].some(
    (key) => cleanTokens[key],
  );
  if (hasColorKeys) return { primitive: cleanTokens };
  return cleanTokens;
}

function filterMetadata(obj) {
  if (typeof obj !== 'object' || obj === null) return obj;
  const filtered = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === '$value') {
      let processedValue = value;
      if (typeof value === 'string' && value.includes('{primitives.')) {
        processedValue = value.replace(/\{primitives\./g, '{primitive.');
      }
      filtered['value'] = processedValue;
      continue;
    }
    if (key.startsWith('$')) continue;
    if (typeof value === 'object' && value !== null) filtered[key] = filterMetadata(value);
    else filtered[key] = value;
  }
  return filtered;
}

function flattenValues(obj) {
  if (typeof obj !== 'object' || obj === null) return obj;
  if (obj.hasOwnProperty('value')) {
    let val = obj.value;
    if (typeof val === 'string' && val.includes('{primitives.')) val = val.replace(/\{primitives\./g, '{primitive.');
    return val;
  }
  if (obj.hasOwnProperty('$value')) {
    let val = obj.$value;
    if (typeof val === 'string' && val.includes('{primitives.')) val = val.replace(/\{primitives\./g, '{primitive.');
    return val;
  }
  const flattened = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key.startsWith('$')) continue;
    flattened[key] = flattenValues(value);
  }
  return flattened;
}

StyleDictionary.registerTransform({
  name: 'attribute/wrap-primitives',
  type: 'attribute',
  matcher: () => true,
  transformer: (token) => token.attributes || {},
});

StyleDictionary.registerTransform({
  name: 'name/custom',
  type: 'name',
  matcher: () => true,
  transformer: (token) => {
    let newPath = [...token.path];
    if (THEME_MODE === 'light' || THEME_MODE === 'dark' || THEME_MODE === 'merged') {
      newPath = newPath.filter((part) => part !== 'modeLight' && part !== 'modeDark');
    } else {
      newPath = newPath
        .filter((part) => part !== 'modeLight')
        .map((part) => (part === 'modeDark' ? 'mode-dark' : part));
    }
    return newPath.join('-').toLowerCase();
  },
});

StyleDictionary.registerTransform({
  name: 'value/shadow-css',
  type: 'value',
  matcher: (token) =>
    token.path.includes('shadow') &&
    !token.path.includes('full') &&
    token.original.value &&
    typeof token.original.value === 'object' &&
    token.original.value.positionX,
  transformer: (token) => {
    const val = token.original.value;
    const x = val.positionX.$value || val.positionX;
    const y = val.positionY.$value || val.positionY;
    const blur = val.blur.$value || val.blur;
    const spread = val.spread.$value || val.spread;
    const color = val.color.$value || val.color;
    return `${x} ${y} ${blur} ${spread} ${color}`;
  },
});

function shouldIncludeToken(token) {
  const hasLightMode = token.path.includes('modeLight');
  const hasDarkMode = token.path.includes('modeDark');
  if (THEME_MODE === 'light') return !hasDarkMode;
  if (THEME_MODE === 'dark') return !hasLightMode;
  return true;
}

StyleDictionary.registerFormat({
  name: 'typescript/object-custom',
  formatter: function ({ dictionary, options }) {
    const objectName = options.objectName || 'tokens';
    const isPrimitive = options.isPrimitive || false;
    const cleanObject = (obj) => {
      const newObj = {};
      for (const key in obj) {
        if (['original', 'filePath', 'isSource', 'path', 'name', 'attributes', 'value'].includes(key)) continue;
        const item = obj[key];
        if (item && item.hasOwnProperty('value')) {
          if (item.isSource === false) continue;
          newObj[key] = item.original.value;
        } else if (typeof item === 'object') {
          const child = cleanObject(item);
          if (Object.keys(child).length > 0) newObj[key] = child;
        }
      }
      return newObj;
    };
    let tokens = cleanObject(dictionary.properties);
    if (isPrimitive && tokens.primitive) tokens = tokens.primitive;
    return `export const ${objectName} = ${JSON.stringify(tokens, null, 4)};\n`;
  },
});

StyleDictionary.registerFormat({
  name: 'scss/theme-map',
  formatter: function ({ dictionary }) {
    const lightTokens = {};
    const darkTokens = {};
    const otherTokens = {};
    dictionary.allProperties.forEach((prop) => {
      if (prop.filePath && prop.filePath.includes('semantics')) {
        let value = prop.value;
        if (typeof value === 'object' && value !== null) value = value.$value || value.value || JSON.stringify(value);
        let cleanName = prop.name
          .replace('mode-light-', '')
          .replace('mode-dark-', '')
          .replace('modelight-', '')
          .replace('modedark-', '');
        const isLight = prop.path.includes('modeLight');
        const isDark = prop.path.includes('modeDark');
        if (isLight) lightTokens[cleanName] = value;
        else if (isDark) darkTokens[cleanName] = value;
        else otherTokens[cleanName] = value;
      }
    });
    let output = '';
    const metricsPath = path.join(SOURCE_ROOT, 'metrics.json');
    const emitShadows = (tokens) => {
      if (!fs.existsSync(metricsPath)) return;
      const metricsData = JSON.parse(fs.readFileSync(metricsPath, 'utf8'));
      if (!metricsData.shadow) return;
      for (const [size, m] of Object.entries(metricsData.shadow)) {
        for (const [name, value] of Object.entries(tokens)) {
          if (name.startsWith('effects-')) {
            const variant = name.replace('effects-', '');
            const getV = (t) => t.$value || t;
            const val = `${getV(m.positionX)} ${getV(m.positionY)} ${getV(m.blur)} ${getV(m.spread)} ${value}`;
            output += `      "shadow-${size}-${variant}": ${val},\n`;
          }
        }
      }
    };
    if (THEME_MODE === 'light' || THEME_MODE === 'merged') {
      output += `    "light": (\n`;
      for (const [name, value] of Object.entries(lightTokens)) output += `      "${name}": ${value},\n`;
      for (const [name, value] of Object.entries(otherTokens)) output += `      "${name}": ${value},\n`;
      output += `    ),\n    "dark": (\n    ),\n`;
    } else if (THEME_MODE === 'dark') {
      output += `    "light": (\n    ),\n    "dark": (\n`;
      for (const [name, value] of Object.entries(darkTokens)) output += `      "${name}": ${value},\n`;
      for (const [name, value] of Object.entries(otherTokens)) output += `      "${name}": ${value},\n`;
      output += `    ),\n`;
    } else {
      output += `    "light": (\n`;
      for (const [name, value] of Object.entries(lightTokens)) output += `      "${name}": ${value},\n`;
      for (const [name, value] of Object.entries(otherTokens)) output += `      "${name}": ${value},\n`;
      emitShadows(lightTokens);
      output += `    ),\n    "dark": (\n`;
      for (const [name, value] of Object.entries(darkTokens)) output += `      "${name}": ${value},\n`;
      emitShadows(darkTokens);
      output += `    ),\n`;
    }
    return output;
  },
});

StyleDictionary.registerFormat({
  name: 'css/variables-no-prefix',
  formatter: function ({ dictionary, options }) {
    const header = (FILE_HEADER || '/* Auto-generated — do not edit */') + '\n\n';
    const tokenName = options.tokenName || '';
    const varPrefix = USE_CSS_VARIABLES ? '--' : '$';
    const wrapperStart = USE_CSS_VARIABLES ? ':root {\n' : '';
    const wrapperEnd = USE_CSS_VARIABLES ? '}\n' : '';
    let output = header + wrapperStart;
    dictionary.allProperties.forEach((prop) => {
      if (prop.isSource === false) return;
      let varName = prop.name;
      if (tokenName && varName.startsWith(tokenName + '-')) varName = varName.substring(tokenName.length + 1);
      const padding = ' '.repeat(Math.max(1, 30 - varName.length));
      output += `  ${varPrefix}${varName}:${padding}${prop.value};\n`;
    });
    output += wrapperEnd;
    return output;
  },
});

StyleDictionary.registerFormat({
  name: 'scss/responsive-variables',
  formatter: function ({ dictionary }) {
    const header = (FILE_HEADER || '/* Auto-generated — do not edit */') + '\n\n';
    const varPrefix = USE_CSS_VARIABLES ? '--' : '$';
    const wrapperStart = USE_CSS_VARIABLES ? ':root {\n' : '';
    const wrapperEnd = USE_CSS_VARIABLES ? '}\n' : '';
    let output = header;
    const tokensByName = {};
    const bpOrder = ['mobile', 'tablet', 'desktop'];
    const root = dictionary.properties || {};
    const bpRoot = root.responsive || root;
    function collect(bp, obj, pathParts = []) {
      if (!obj || typeof obj !== 'object') return;
      if (Object.prototype.hasOwnProperty.call(obj, 'value')) {
        const filtered = pathParts.filter((p) => p !== 'screen');
        if (!filtered.length) return;
        const name = filtered.join('-');
        if (!tokensByName[name]) tokensByName[name] = {};
        tokensByName[name][bp] = obj.value;
        return;
      }
      for (const [k, v] of Object.entries(obj)) {
        if (k.startsWith('$')) continue;
        collect(bp, v, [...pathParts, k]);
      }
    }
    bpOrder.forEach((bp) => {
      if (bpRoot[bp]) collect(bp, bpRoot[bp], []);
    });
    output += wrapperStart;
    for (const [name, values] of Object.entries(tokensByName)) {
      output += `  ${varPrefix}${name}: ${values.mobile || Object.values(values)[0]};\n`;
    }
    const tabletWidth = (tokensByName['width'] && tokensByName['width'].tablet) || '1024px';
    output += `\n  @media (min-width: ${tabletWidth}) {\n`;
    for (const [name, values] of Object.entries(tokensByName)) {
      if (values.tablet) output += `    ${varPrefix}${name}: ${values.tablet};\n`;
    }
    output += `  }\n`;
    const desktopWidth = (tokensByName['width'] && tokensByName['width'].desktop) || '1440px';
    output += `\n  @media (min-width: ${desktopWidth}) {\n`;
    for (const [name, values] of Object.entries(tokensByName)) {
      if (values.desktop) output += `    ${varPrefix}${name}: ${values.desktop};\n`;
    }
    output += `  }\n${wrapperEnd}`;
    return output;
  },
});

// -----------------------------------------------------------------------
// 2. BUILD TYPESCRIPT FILES
// -----------------------------------------------------------------------
console.log('📦 Building TypeScript tokens...');
const tempDir = path.join(ROOT, TEMP_DIR);
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

function generatePrimitivesInterface(sampleTokens, outputPath) {
  let c = '// Auto-generated — do not edit\n';
  c += 'export interface ' + ((config.tokens.primitives && config.tokens.primitives.interfaceName) || 'ThemePrimitives') + ' {\n';
  for (const [paletteName, paletteValues] of Object.entries(sampleTokens)) {
    if (paletteName.startsWith('$')) continue;
    if (typeof paletteValues === 'object' && paletteValues !== null) {
      c += `    ${paletteName}: {\n`;
      const keys = Object.keys(paletteValues).filter((k) => !k.startsWith('$'));
      keys.sort((a, b) => {
        const na = parseInt(a);
        const nb = parseInt(b);
        if (!isNaN(na) && !isNaN(nb)) return na - nb;
        if (a === 'base') return 1;
        if (b === 'base') return -1;
        return a.localeCompare(b);
      });
      for (const key of keys) {
        const value = paletteValues[key];
        if (typeof value === 'string' || (typeof value === 'object' && value !== null && (value.$value || value.value))) {
          c += `        "${key}": string;\n`;
        } else if (typeof value === 'object' && value !== null) {
          c += `        "${key}": {\n`;
          for (const [subKey, subValue] of Object.entries(value)) {
            if (subKey.startsWith('$')) continue;
            if (typeof subValue === 'string' || (typeof subValue === 'object' && subValue !== null && (subValue.$value || subValue.value))) {
              c += `            "${subKey}": string;\n`;
            }
          }
          c += `        };\n`;
        }
      }
      c += `    };\n`;
    }
  }
  c += '}\n';
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, c);
}

(THEMES || []).forEach((prim, i) => {
  const primitivePath = path.join(SOURCE_ROOT, 'primitives', prim.primitiveFile);
  if (!fs.existsSync(primitivePath)) return;
  const primitiveData = JSON.parse(fs.readFileSync(primitivePath, 'utf8'));
  const wrappedTokens = wrapPrimitivesIfNeeded(primitiveData);
  const tempPrimPath = path.join(tempDir, prim.primitiveFile);
  fs.writeFileSync(tempPrimPath, JSON.stringify(wrappedTokens, null, 2));
  if (i === 0 && config.tokens.primitives && config.tokens.primitives.generateInterface) {
    generatePrimitivesInterface(
      wrappedTokens.primitive || wrappedTokens,
      path.join(PRESET_OUTPUT, 'primitives', 'primitives.interface.ts'),
    );
  }
  const primConfig = {
    source: [tempPrimPath],
    platforms: {
      ts: {
        transformGroup: 'js',
        buildPath: path.join(PRESET_OUTPUT, 'primitives') + '/',
        files: [
          {
            destination: `${prim.objectName || prim.name + 'Primitives'}.ts`,
            format: 'typescript/object-custom',
            options: { objectName: prim.objectName || prim.name + 'Primitives', isPrimitive: true },
          },
        ],
      },
    },
  };
  StyleDictionary.extend(primConfig).buildAllPlatforms();
});

const otherTokens = [
  { file: 'metrics.json', name: 'metrics' },
  { file: 'typography.json', name: 'typography' },
  { file: 'responsive.json', name: 'responsive' },
  { file: 'transitions.json', name: 'transitions' },
  { file: 'breakpoints.json', name: 'breakpoints' },
];
let metricsWrappedPath = null;

otherTokens.forEach((token) => {
  const entry = config.tokens[token.name];
  if (!entry || entry.enabled === false || entry.generateTypescript === false) return;
  const filePath = path.join(SOURCE_ROOT, token.file);
  if (!fs.existsSync(filePath)) return;
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const filteredData = filterMetadata(data);
  const tempPath = path.join(tempDir, token.file);
  fs.writeFileSync(tempPath, JSON.stringify(filteredData, null, 2));
  if (token.file === 'metrics.json') {
    metricsWrappedPath = path.join(tempDir, 'metrics-wrapped.json');
    fs.writeFileSync(metricsWrappedPath, JSON.stringify({ metrics: filteredData }, null, 2));
  }
  const defaultThemePrim = (THEMES || []).find((t) => t.name === DEFAULT_THEME) || (THEMES || [])[0];
  const defaultPrimTempPath = defaultThemePrim ? path.join(tempDir, defaultThemePrim.primitiveFile) : null;
  const cfg = {
    source: [tempPath],
    include: [
      ...(token.name === 'responsive' && metricsWrappedPath && fs.existsSync(metricsWrappedPath) ? [metricsWrappedPath] : []),
      ...(defaultPrimTempPath && fs.existsSync(defaultPrimTempPath) ? [defaultPrimTempPath] : []),
    ],
    platforms: {
      ts: {
        transformGroup: 'js',
        buildPath: PRESET_OUTPUT + '/',
        files: [
          {
            destination: `${token.name}.ts`,
            format: 'typescript/object-custom',
            options: { objectName: `${EXPORT_PREFIX}${cap(token.name)}` },
          },
        ],
      },
    },
  };
  try {
    StyleDictionary.extend(cfg).buildAllPlatforms();
  } catch (e) {
    console.log(`   ⚠️ Could not build TS for ${token.name}:`, e.message);
  }
});

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Semantics + shadows: generated manually to preserve references.
try {
  const semanticsPath = path.join(SOURCE_ROOT, 'semantics.json');
  const metricsPath = path.join(SOURCE_ROOT, 'metrics.json');
  if (fs.existsSync(semanticsPath) && config.tokens.semantics && config.tokens.semantics.generateTypescript !== false) {
    const data = JSON.parse(fs.readFileSync(semanticsPath, 'utf8'));
    const flattenedData = flattenValues(data);
    fs.mkdirSync(PRESET_OUTPUT, { recursive: true });
    fs.writeFileSync(path.join(PRESET_OUTPUT, 'semantics.ts'), `export const ${EXPORT_PREFIX}Semantics = ${JSON.stringify(flattenedData, null, 4)};\n`);
    console.log('   ✔︎ semantics.ts');

    if (fs.existsSync(metricsPath) && data.effects) {
      const metricsData = JSON.parse(fs.readFileSync(metricsPath, 'utf8'));
      const primMap = {};
      const defaultThemePrim = (THEMES || []).find((t) => t.name === DEFAULT_THEME) || (THEMES || [])[0];
      const primPath = defaultThemePrim ? path.join(SOURCE_ROOT, 'primitives', defaultThemePrim.primitiveFile) : null;
      if (primPath && fs.existsSync(primPath)) {
        const primData = JSON.parse(fs.readFileSync(primPath, 'utf8'));
        const flattener = (o, p = '') => {
          const flat = {};
          for (const [k, v] of Object.entries(o)) {
            const pp = p ? `${p}.${k}` : k;
            if (typeof v === 'object' && v !== null && !v.hasOwnProperty('$value') && !v.hasOwnProperty('value')) Object.assign(flat, flattener(v, pp));
            else flat[pp] = v.$value || v.value || v;
          }
          return flat;
        };
        const flatPrims = flattener(primData.primitive || primData);
        for (const [k, v] of Object.entries(flatPrims)) primMap[`primitive.${k}`] = v;
      }
      const resolve = (val, currentEffects) => {
        if (typeof val !== 'string' || !val.includes('{')) return val;
        return val.replace(/\{([^}]+)\}/g, (match, p) => {
          if (p.startsWith('effects.')) return resolve(currentEffects[p.replace('effects.', '')], currentEffects);
          if (primMap[p]) return resolve(primMap[p], currentEffects);
          return match;
        });
      };
      const shadowTokens = { shadow: { modeLight: {}, modeDark: {} } };
      const effectsLight = flattenValues((data.effects && data.effects.modeLight) || data.effects);
      const effectsDark = flattenValues((data.effects && data.effects.modeDark) || data.effects);
      if (metricsData.shadow) {
        for (const [size, m] of Object.entries(metricsData.shadow)) {
          shadowTokens.shadow.modeLight[size] = {};
          shadowTokens.shadow.modeDark[size] = {};
          const getV = (t) => t.$value || t.value || t;
          const geom = `${getV(m.positionX)} ${getV(m.positionY)} ${getV(m.blur)} ${getV(m.spread)}`;
          for (const variant of Object.keys(effectsLight)) shadowTokens.shadow.modeLight[size][variant] = `${geom} ${resolve(`{effects.${variant}}`, effectsLight)}`;
          for (const variant of Object.keys(effectsDark)) shadowTokens.shadow.modeDark[size][variant] = `${geom} ${resolve(`{effects.${variant}}`, effectsDark)}`;
        }
      }
      fs.writeFileSync(path.join(PRESET_OUTPUT, 'shadows.ts'), `export const ${EXPORT_PREFIX}Shadows = ${JSON.stringify(shadowTokens, null, 4)};\n`);
      console.log('   ✔︎ shadows.ts');
    }
  }
} catch (e) {
  console.log('   ⚠️ Could not generate manual TS files:', e.message);
}

// -----------------------------------------------------------------------
// 3. BUILD SCSS FILES
// -----------------------------------------------------------------------
console.log('🎨 Building SCSS tokens...');
const outputDir = OUTPUT_DIR;
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

if (config.tokens.semantics && config.tokens.semantics.generateScss !== false) {
  console.log('   - Building Semantics Map...');
  let scssMapContent = '// CONFIGURATION DES THEMES (SCSS MAP)\n$themes-config: (\n';
  (THEMES || []).forEach((theme) => {
    const primitivePath = path.join(SOURCE_ROOT, 'primitives', theme.primitiveFile);
    if (!fs.existsSync(primitivePath)) return;
    const primitiveData = JSON.parse(fs.readFileSync(primitivePath, 'utf8'));
    const wrappedData = wrapPrimitivesIfNeeded(primitiveData);
    const tempPrimPath = path.join(tempDir, theme.primitiveFile);
    fs.writeFileSync(tempPrimPath, JSON.stringify(wrappedData, null, 2));
    const semanticsData = JSON.parse(fs.readFileSync(path.join(SOURCE_ROOT, 'semantics.json'), 'utf8'));
    const tempSemanticsPath = path.join(tempDir, 'semantics.json');
    fs.writeFileSync(tempSemanticsPath, JSON.stringify(filterMetadata(semanticsData), null, 2));
    const themeConfig = {
      source: [tempSemanticsPath, tempPrimPath],
      platforms: {
        scss_temp: {
          transformGroup: 'scss',
          transforms: ['attribute/cti', 'name/custom', 'color/css'],
          buildPath: tempDir + '/',
          files: [
            {
              destination: `${theme.name}.scss`,
              format: 'scss/theme-map',
              filter: (token) => token.filePath && token.filePath.includes('semantics') && shouldIncludeToken(token),
            },
          ],
        },
      },
    };
    StyleDictionary.extend(themeConfig).buildAllPlatforms();
    const themeData = fs.readFileSync(path.join(tempDir, `${theme.name}.scss`), 'utf8');
    scssMapContent += `  "${theme.name}": (\n${themeData}  ),\n`;
  });
  scssMapContent += ');\n\n';
  scssMapContent += `
@mixin apply-theme-tokens($theme-name) {
  $theme-map: map-get($themes-config, $theme-name);
  $light-tokens: map-get($theme-map, "light");
  $dark-tokens: map-get($theme-map, "dark");
  @if $light-tokens {
    @each $name, $value in $light-tokens { --#{$name}: #{$value}; }
  }
  @if $dark-tokens and length($dark-tokens) > 0 {
    &.dark-mode, .dark-mode & {
      @each $name, $value in $dark-tokens { --#{$name}: #{$value}; }
    }
  }
}
:root { @include apply-theme-tokens("${DEFAULT_THEME}"); }
@each $theme-name, $config in $themes-config {
  ._#{to-lower-case($theme-name)} { @include apply-theme-tokens($theme-name); }
}
`;
  fs.writeFileSync(path.join(outputDir, '_tokens-semantics.scss'), scssMapContent);
  console.log('   ✔︎ _tokens-semantics.scss');
}

console.log('   - Building Metrics & Typography...');
const processFile = (filePath, outputName, tokenName) => {
  const fullPath = path.join(SOURCE_ROOT, filePath);
  if (!fs.existsSync(fullPath)) return;
  const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  fs.writeFileSync(path.join(tempDir, filePath), JSON.stringify(filterMetadata(data), null, 2));
  const defaultThemePrim = (THEMES || []).find((t) => t.name === DEFAULT_THEME) || (THEMES || [])[0];
  const defaultPrimTempPath = defaultThemePrim ? path.join(tempDir, defaultThemePrim.primitiveFile) : null;
  const cfg = {
    source: [path.join(tempDir, filePath)],
    include: defaultPrimTempPath && fs.existsSync(defaultPrimTempPath) ? [defaultPrimTempPath] : [],
    platforms: {
      scss: {
        transformGroup: 'css',
        transforms: ['attribute/cti', 'name/cti/kebab', 'color/css'],
        buildPath: outputDir + '/',
        files: [
          {
            destination: outputName,
            format: 'css/variables-no-prefix',
            options: { tokenName },
            filter: (token) => token.filePath && token.filePath.includes(filePath),
          },
        ],
      },
    },
  };
  StyleDictionary.extend(cfg).buildAllPlatforms();
};
if (config.tokens.metrics && config.tokens.metrics.generateScss !== false) processFile('metrics.json', '_tokens-metrics.scss', 'metrics');
if (config.tokens.typography && config.tokens.typography.generateScss !== false) processFile('typography.json', '_tokens-typography.scss', 'typography');
if (config.tokens.transitions && config.tokens.transitions.generateScss !== false) processFile('transitions.json', '_tokens-transitions.scss', 'transitions');

console.log('   - Building Breakpoints & Responsive...');
try {
  const breakpointsPath = path.join(SOURCE_ROOT, 'breakpoints.json');
  if (fs.existsSync(breakpointsPath)) {
    const bpData = JSON.parse(fs.readFileSync(breakpointsPath, 'utf8'));
    const bp = bpData.breakpoints || bpData;
    let c = '// Breakpoints SCSS\n';
    for (const [key, raw] of Object.entries(bp)) {
      if (key.startsWith('$')) continue;
      const val = raw && typeof raw === 'object' ? raw.value || raw.$value : raw;
      c += `$breakpoint-${key}: ${val};\n`;
    }
    fs.writeFileSync(path.join(outputDir, '_tokens-breakpoints.scss'), c);
    console.log('   ✔︎ _tokens-breakpoints.scss');
  }
  const responsivePath = path.join(tempDir, 'responsive.json');
  if (config.tokens.responsive && config.tokens.responsive.generateScss !== false && fs.existsSync(responsivePath)) {
    const defaultThemePrim = (THEMES || []).find((t) => t.name === DEFAULT_THEME) || (THEMES || [])[0];
    const defaultPrimTempPath = defaultThemePrim ? path.join(tempDir, defaultThemePrim.primitiveFile) : null;
    const include = [];
    if (metricsWrappedPath && fs.existsSync(metricsWrappedPath)) include.push(metricsWrappedPath);
    if (defaultPrimTempPath && fs.existsSync(defaultPrimTempPath)) include.push(defaultPrimTempPath);
    const responsiveConfig = {
      source: [responsivePath],
      include,
      platforms: {
        scss: {
          transformGroup: 'css',
          transforms: ['attribute/cti', 'name/cti/kebab', 'color/css'],
          buildPath: outputDir + '/',
          files: [
            {
              destination: '_tokens-responsive.scss',
              format: 'scss/responsive-variables',
              filter: (token) => token.filePath.includes('responsive.json'),
            },
          ],
        },
      },
    };
    StyleDictionary.extend(responsiveConfig).buildAllPlatforms();
    console.log('   ✔︎ _tokens-responsive.scss');
  }
} catch (e) {
  console.log('   ⚠️ Could not build responsive tokens:', e.message);
}

// -----------------------------------------------------------------------
// 4. GENERATE INDEX FILE
// -----------------------------------------------------------------------
const indexFile = (config.structure && config.structure.indexFile) || '_tokens.scss';
fs.writeFileSync(
  path.join(outputDir, indexFile),
  `@forward './tokens-breakpoints';\n@forward './tokens-metrics';\n@forward './tokens-typography';\n@forward './tokens-responsive';\n@forward './tokens-semantics';\n@forward './tokens-transitions';\n`,
);
console.log('   ✔︎ ' + indexFile);
console.log('✨ Done.');
