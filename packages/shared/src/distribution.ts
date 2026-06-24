import { z } from 'zod';

/**
 * Phase 4 — Distribution (token-config.json companion).
 *
 * Token Flow Manager projects drive their Style Dictionary build through a rich
 * **manifest** (`token-config.json`) consumed by a project-owned build script
 * (`build-tokens-sd.js`). This models that manifest for visual editing. Unknown
 * keys round-trip: the server merges the edited model back over the on-disk
 * object, so a hand-tuned manifest never loses fields.
 */

/** Theme strategy: which mode(s) to emit and how. */
export const ThemeModeKindSchema = z.enum(['light', 'dark', 'merged', 'both']);
export type ThemeModeKind = z.infer<typeof ThemeModeKindSchema>;

export const ManifestOutputSchema = z.object({
  /** CSS custom properties (`--x`) vs SCSS variables (`$x`). */
  useCssVariables: z.boolean().default(true),
  /** Build output directory for generated SCSS/CSS. */
  buildPath: z.string().default('src/styles/generated/'),
  /** Prefix for generated TS object names (e.g. `myTheme` → `myThemeMetrics`). */
  exportPrefix: z.string().default('theme'),
});
export type ManifestOutput = z.infer<typeof ManifestOutputSchema>;

export const ManifestThemeModeSchema = z.object({
  mode: ThemeModeKindSchema.default('both'),
  /** Theme used for `:root` defaults. */
  defaultTheme: z.string().default(''),
  /** Selector receiving light values. */
  lightSelector: z.string().default(':root'),
  /** Selector receiving dark overrides. */
  darkSelector: z.string().default("[data-theme='dark'], .dark-mode"),
});
export type ManifestThemeMode = z.infer<typeof ManifestThemeModeSchema>;

/** One brand/theme: a primitive palette file + its generated TS object name. */
export const ManifestThemeSchema = z.object({
  name: z.string(),
  primitiveFile: z.string(),
  objectName: z.string().optional(),
});
export type ManifestTheme = z.infer<typeof ManifestThemeSchema>;

/** Per-concern token group (primitives, semantics, metrics, …). */
export const ManifestTokenEntrySchema = z.object({
  enabled: z.boolean().default(true),
  sourceFile: z.string().optional(),
  sourcePath: z.string().optional(),
  outputPath: z.string().optional(),
  scssOutputPath: z.string().optional(),
  generateTypescript: z.boolean().optional(),
  generateScss: z.boolean().optional(),
  generateInterface: z.boolean().optional(),
  interfaceName: z.string().optional(),
  useMediaQueries: z.boolean().optional(),
});
export type ManifestTokenEntry = z.infer<typeof ManifestTokenEntrySchema>;

export const ManifestStructureSchema = z.object({
  perTokenFile: z.boolean().optional(),
  indexFile: z.string().optional(),
  tempDirectory: z.string().default('.temp-tokens'),
  /** Root folder holding the source token JSON files. */
  sourceRoot: z.string().optional(),
  /** Output folder for the generated TS preset (defaults derived from prefix). */
  presetOutputPath: z.string().optional(),
});
export type ManifestStructure = z.infer<typeof ManifestStructureSchema>;

export const ManifestCommentsSchema = z.object({
  fileHeader: z.string().optional(),
});
export type ManifestComments = z.infer<typeof ManifestCommentsSchema>;

/** The editable `token-config.json` manifest model. */
export const TokenConfigManifestSchema = z.object({
  output: ManifestOutputSchema,
  themeMode: ManifestThemeModeSchema,
  themes: z.array(ManifestThemeSchema).default([]),
  tokens: z.record(ManifestTokenEntrySchema).default({}),
  structure: ManifestStructureSchema,
  comments: ManifestCommentsSchema.default({}),
});
export type TokenConfigManifest = z.infer<typeof TokenConfigManifestSchema>;

/** A token-related npm script found in package.json. */
export const NpmScriptSchema = z.object({ name: z.string(), command: z.string() });
export type NpmScript = z.infer<typeof NpmScriptSchema>;

/** The project's installed Style Dictionary version + which generator fits. */
export const SdVersionInfoSchema = z.object({
  installed: z.number().nullable(),
  mode: z.enum(['v3', 'v5', 'none']),
});
export type SdVersionInfo = z.infer<typeof SdVersionInfoSchema>;

/**
 * Pointer to an EXTERNAL build the project already owns ("I have my own config").
 * TFM does not generate anything in this mode — it links a config + a build
 * command and can run that real command (which WRITES the project's outputs).
 */
export const LinkedConfigSchema = z.object({
  /** Relative path of the existing config file (or '' if only a command). */
  configPath: z.string(),
  /** The shell command that runs the project's build (e.g. `npm run generate:tokens`). */
  buildCommand: z.string(),
});
export type LinkedConfig = z.infer<typeof LinkedConfigSchema>;

/** A collection (drives the themes/tokens suggestions). */
export const DistributionCollectionSchema = z.object({
  name: z.string(),
  files: z.array(z.string()),
  modes: z.array(z.string()),
});
export type DistributionCollection = z.infer<typeof DistributionCollectionSchema>;

/** Full snapshot the Distribution UI renders from. */
export const DistributionStateSchema = z.object({
  /** Stable id of the open project (its root) — scopes client-side drafts so they never leak across projects. */
  projectId: z.string(),
  /** Relative path of the manifest, or null if none exists yet. */
  manifestPath: z.string().nullable(),
  exists: z.boolean(),
  /** Parsed manifest model (null when no manifest / unparsable). */
  manifest: TokenConfigManifestSchema.nullable(),
  /** Project collections (suggest themes/source files). */
  collections: z.array(DistributionCollectionSchema),
  /** Distinct modes across collections (for the light/dark mapping context). */
  modes: z.array(z.string()),
  /** Whether a build script + npm script already exist. */
  hasBuildScript: z.boolean(),
  buildScriptPath: z.string().nullable(),
  /** Token-related npm scripts present in package.json. */
  npmScripts: z.array(NpmScriptSchema),
  /** Whether `style-dictionary` resolves (the build script needs it). */
  styleDictionaryAvailable: z.boolean(),
  /** The project's installed Style Dictionary version + which generator fits. */
  sdVersion: SdVersionInfoSchema,
  /** Previously-saved v5 matrix (sidecar `.tokenflow/distribution.json`), if any. */
  savedMatrix: z.unknown().nullable(),
  /** Relative path of a written v5 build script, if present. */
  v5ScriptPath: z.string().nullable(),
  /** Pointer to an external build the project already owns ("I have my config"). */
  linked: LinkedConfigSchema.nullable(),
  /** Config-file candidates found at the project root (suggestions for linking). */
  detectedConfigs: z.array(z.string()),
  warnings: z.array(z.string()),
});
export type DistributionState = z.infer<typeof DistributionStateSchema>;

// ---- Requests ----

export const UpdateManifestRequestSchema = z.object({
  manifest: TokenConfigManifestSchema,
});
export type UpdateManifestRequest = z.infer<typeof UpdateManifestRequestSchema>;

export const InitManifestRequestSchema = z.object({
  /** Also scaffold the build script + npm scripts. */
  scaffoldScript: z.boolean().default(true),
});
export type InitManifestRequest = z.infer<typeof InitManifestRequestSchema>;

// ---- Phase 4 redesign: Style Dictionary v5 matrix + test build ----
//
// A collection has VARIANTS (named) — never a guessed "nature". A variant is
// either a path-segment mode (no `file`) or a theme file (`file` set). How a
// target renders a source's variants is a generic STRATEGY chosen per
// (source × target), with a per-variant value map.

/** One named variant of a source. `file` set = a theme file; absent = a mode segment. */
export const MatrixVariantSchema = z.object({
  name: z.string(),
  file: z.string().optional(),
});
export type MatrixVariant = z.infer<typeof MatrixVariantSchema>;

export const MatrixSourceSchema = z.object({
  id: z.string(),
  label: z.string(),
  files: z.array(z.string()),
  /** Namespace to wrap this source under so `{ns.x}` references resolve. */
  wrapUnder: z.string().optional(),
  /** Detected named variants (empty = none). No semantics inferred. */
  variants: z.array(MatrixVariantSchema).default([]),
});
export type MatrixSource = z.infer<typeof MatrixSourceSchema>;

/** How one target renders one source's variants. */
export const RenderStrategySchema = z.enum(['selectors', 'media', 'files', 'single']);
export type RenderStrategy = z.infer<typeof RenderStrategySchema>;

export const TargetRenderingSchema = z.object({
  strategy: RenderStrategySchema,
  /** variant name → value (CSS selector for `selectors`, media condition for `media`). */
  map: z.record(z.string()).optional(),
});
export type TargetRendering = z.infer<typeof TargetRenderingSchema>;

export const MatrixTargetSchema = z.object({
  id: z.string(),
  label: z.string(),
  /** SD format (e.g. `css/variables`, `javascript/es6`, `scss/variables`). */
  format: z.string(),
  /** Output directory (relative to project root). */
  destination: z.string(),
  prefix: z.string().optional(),
  /** Source ids emitted by this target (or 'all'). */
  sources: z.union([z.array(z.string()), z.literal('all')]),
  /** Per-source render strategy + mapping (keyed by source id). Missing = heuristic default. */
  rendering: z.record(TargetRenderingSchema).optional(),
  options: z.record(z.unknown()).optional(),
});
export type MatrixTarget = z.infer<typeof MatrixTargetSchema>;

export const DistMatrixSchema = z.object({
  sourceRoot: z.string(),
  sources: z.array(MatrixSourceSchema),
  targets: z.array(MatrixTargetSchema),
  /** Add the @tokens-studio/sd-transforms preprocessor. */
  tokensStudio: z.boolean().optional(),
});
export type DistMatrix = z.infer<typeof DistMatrixSchema>;

/** One diagnostic from a test build. */
export const BuildDiagnosticSchema = z.object({
  level: z.enum(['error', 'warn']),
  message: z.string(),
  target: z.string().optional(),
  theme: z.string().optional(),
  token: z.string().optional(),
  reference: z.string().optional(),
});
export type BuildDiagnostic = z.infer<typeof BuildDiagnosticSchema>;

/** Concise report of a test build (dry-run). */
export const DistBuildReportSchema = z.object({
  ok: z.boolean(),
  /** Files that were produced (target label + relative path + byte size). */
  outputs: z.array(z.object({ target: z.string(), file: z.string(), bytes: z.number() })),
  diagnostics: z.array(BuildDiagnosticSchema),
  durationMs: z.number().optional(),
  /** Set when the build could not run at all (e.g. no Style Dictionary). */
  error: z.string().optional(),
});
export type DistBuildReport = z.infer<typeof DistBuildReportSchema>;

export const TestBuildRequestSchema = z.object({ matrix: DistMatrixSchema });
export type TestBuildRequest = z.infer<typeof TestBuildRequestSchema>;

/** Write the v5 build script + npm script, and persist the matrix. */
export const WriteDistributionRequestSchema = z.object({ matrix: DistMatrixSchema });
export type WriteDistributionRequest = z.infer<typeof WriteDistributionRequestSchema>;

// ---- "I have my own config" — link an external build ----

/** Link an existing config + build command (persisted to a sidecar). */
export const LinkConfigRequestSchema = LinkedConfigSchema;
export type LinkConfigRequest = z.infer<typeof LinkConfigRequestSchema>;

/** Run the project's real build command (cwd = root). WRITES real outputs. */
export const RunCommandRequestSchema = z.object({ buildCommand: z.string() });
export type RunCommandRequest = z.infer<typeof RunCommandRequestSchema>;

export const WriteDistributionResultSchema = z.object({
  ok: z.boolean(),
  /** Relative path of the written build script. */
  scriptPath: z.string(),
  /** The npm script that runs the build. */
  npmScript: NpmScriptSchema,
  /** Whether the npm script was newly added (false = already present). */
  npmAdded: z.boolean(),
  /** Dependency specs (`name@range`) added to devDependencies (empty = none needed). */
  addedDependencies: z.array(z.string()).default([]),
  error: z.string().optional(),
});
export type WriteDistributionResult = z.infer<typeof WriteDistributionResultSchema>;
