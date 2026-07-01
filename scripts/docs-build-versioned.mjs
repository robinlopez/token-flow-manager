// ============================================================================
// Versioned documentation build (Zensical).
// ----------------------------------------------------------------------------
// Builds every documented version into its own subdirectory of `site/`, in a
// layout the Material/Zensical version selector understands (it reads the
// `versions.json` we write at the site root). The header version selector is
// enabled via `[project.extra.version]` in zensical.toml / zensical.fr.toml.
//
// Layout produced:
//   site/<version>/         English docs for that version
//   site/<version>/fr/      French docs for that version
//   site/versions.json      mike-compatible version index
//   site/index.html         redirect to the latest version
//
// Each version's English/French markdown source is listed in VERSIONS. The
// current docs (docs/en, docs/fr) are the latest; older versions are frozen
// snapshots under docs-archive/<version>/.
//
// Temp config files are written at the repo root (next to the base configs)
// because Zensical resolves docs_dir / site_dir relative to the config file's
// own directory, and rejects absolute paths.
// ============================================================================
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const BASE_URL = 'https://robinlopez.github.io/token-flow-manager';
const SITE = 'site';

// Newest first. `aliases` are advisory (shown in the selector); the directory
// is always named by `version`.
const VERSIONS = [
  { version: '0.1.4', title: '0.1.4 (latest)', aliases: ['latest'], en: 'docs/en', fr: 'docs/fr' },
  { version: '0.1.3', title: '0.1.3', aliases: [], en: 'docs-archive/0.1.3/en', fr: 'docs-archive/0.1.3/fr' },
];
const latest = VERSIONS[0];
const tmpConfigs = [];

/** Clone a base Zensical config (at repo root), overriding docs_dir / site_dir / site_url. */
function writeConfig(baseFile, outFile, { docsDir, siteDir, siteUrl }) {
  let t = readFileSync(baseFile, 'utf8');
  t = t.replace(/^docs_dir\s*=.*$/m, `docs_dir = "${docsDir}"`);
  t = t.replace(/^site_url\s*=.*$/m, `site_url = "${siteUrl}"`);
  if (/^site_dir\s*=.*$/m.test(t)) t = t.replace(/^site_dir\s*=.*$/m, `site_dir = "${siteDir}"`);
  else t = t.replace(/^docs_dir\s*=.*$/m, (m) => `${m}\nsite_dir = "${siteDir}"`);
  writeFileSync(outFile, t);
  tmpConfigs.push(outFile);
}

function build(configFile) {
  execFileSync('zensical', ['build', '-f', configFile], { stdio: 'inherit' });
}

rmSync(SITE, { recursive: true, force: true });

try {
  for (const v of VERSIONS) {
    // English first (writes site/<version>), then French (site/<version>/fr).
    const enCfg = `.zendocs-en-${v.version}.toml`;
    writeConfig('zensical.toml', enCfg, { docsDir: v.en, siteDir: `${SITE}/${v.version}`, siteUrl: `${BASE_URL}/${v.version}/` });
    build(enCfg);

    const frCfg = `.zendocs-fr-${v.version}.toml`;
    writeConfig('zensical.fr.toml', frCfg, { docsDir: v.fr, siteDir: `${SITE}/${v.version}/fr`, siteUrl: `${BASE_URL}/${v.version}/fr/` });
    build(frCfg);
    console.log(`  built ${v.version} (en + fr)`);
  }

  mkdirSync(SITE, { recursive: true });
  const versionsJson = VERSIONS.map((v) => ({ version: v.version, title: v.title, aliases: v.aliases }));
  writeFileSync(join(SITE, 'versions.json'), JSON.stringify(versionsJson, null, 2) + '\n');

  const redirect = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="refresh" content="0; url=./${latest.version}/">
<link rel="canonical" href="${BASE_URL}/${latest.version}/">
<title>Token Flow Manager</title></head>
<body>Redirecting to the <a href="./${latest.version}/">latest documentation</a>.</body></html>\n`;
  writeFileSync(join(SITE, 'index.html'), redirect);
} finally {
  for (const f of tmpConfigs) rmSync(f, { force: true });
}

console.log(`\n✔ Versioned docs built → ${SITE}/  (versions: ${VERSIONS.map((v) => v.version).join(', ')}; latest = ${latest.version})`);
