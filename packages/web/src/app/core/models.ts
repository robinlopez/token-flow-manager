// Frontend mirror of the @tokenflow/shared API shapes (decoupled to avoid
// bundling zod into the dashboard).

export type DtcgType =
  | 'color'
  | 'dimension'
  | 'fontFamily'
  | 'fontWeight'
  | 'duration'
  | 'cubicBezier'
  | 'number'
  | 'strokeStyle'
  | 'border'
  | 'transition'
  | 'shadow'
  | 'gradient'
  | 'typography';

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export interface Diagnostic {
  code: string;
  severity: DiagnosticSeverity;
  message: string;
  tokenId?: string;
  mode?: string;
  file?: string;
  line?: number;
  column?: number;
  quickFixes?: QuickFix[];
}

export interface TokenSource {
  file: string;
  line: number;
  column: number;
}

export interface ParsedToken {
  id: string;
  path: string[];
  collection: string;
  group: string;
  /** DTCG type, an inferred type, or "unknown" for untyped tokens. */
  type: string;
  rawValuesByMode: Record<string, unknown>;
  resolvedValuesByMode: Record<string, unknown>;
  isAlias: boolean;
  aliasChainsByMode?: Record<string, string[][]>;
  description?: string;
  deprecated?: boolean | string;
  source: TokenSource;
  diagnostics: Diagnostic[];
}

export interface ModeDefinition {
  id: string;
  label?: string;
}

export interface GroupNode {
  name: string;
  path: string[];
  type?: string;
  description?: string;
  children: GroupNode[];
  tokenCount: number;
}

export interface Collection {
  id: string;
  name: string;
  files: string[];
  modes: ModeDefinition[];
  groups: GroupNode[];
  tokens: ParsedToken[];
}

export interface CollectionSummary {
  id: string;
  name: string;
  files: string[];
  modes: ModeDefinition[];
  /** Effective path-segment mode dimension (configured or auto-detected), if any. */
  modeDimension?: number;
  tokenCount: number;
  errorCount: number;
  warningCount: number;
}

/** Undo/redo history summary (Phase 3.6). */
export interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel?: string;
  redoLabel?: string;
  undo: string[];
  redo: string[];
}

/** Where the project's token organization (collections/modes) comes from. */
export type OrganizationSource = 'manifest' | 'config' | 'auto';

export interface SetupIssue {
  code: 'no-manifest' | 'undetected-modes' | 'mode-count-mismatch';
  collection?: string;
  message: string;
}

export interface ProjectSetup {
  organizationSource: OrganizationSource;
  hasManifest: boolean;
  issues: SetupIssue[];
}

export interface ProjectState {
  /** False when no project is open yet (welcome screen). */
  open?: boolean;
  root: string;
  collections: CollectionSummary[];
  diagnostics: Diagnostic[];
  tokenCount: number;
  history?: HistoryState;
  /** Structural-setup status (organization source + onboarding issues). */
  setup?: ProjectSetup;
}

/** A directory entry from the local folder browser (welcome screen). */
export interface DirEntry {
  name: string;
  path: string;
  isProject: boolean;
}
export interface BrowseResponse {
  path: string;
  parent: string | null;
  entries: DirEntry[];
}
export interface RecentProject {
  path: string;
  name: string;
  exists: boolean;
}

export interface UndoRedoResult {
  ok: boolean;
  reason?: 'empty' | 'diverged';
  label?: string;
  tokenId?: string;
  diverged?: string[];
}

export interface MutationResult {
  ok: boolean;
  token?: ParsedToken;
  affectedTokenIds: string[];
  diagnostics: Diagnostic[];
}

export interface ReferenceInfo {
  id: string;
  path: string[];
  collection: string;
  type: string;
  modes: string[];
}

export interface SearchHit {
  id: string;
  path: string[];
  collection: string;
  type: string;
}

export interface SearchResponse {
  hits: SearchHit[];
  total: number;
}

export interface RenamePreview {
  files: number;
  references: number;
  conflict: boolean;
}

export interface SearchFilters {
  /** Keep only tokens whose type is in this set (empty/absent = no type filter). Includes `'unknown'`. */
  types?: string[];
  collection?: string;
  /** `only` = aliases only, `none` = non-aliases only, absent = both. */
  alias?: 'only' | 'none';
  deprecated?: boolean;
  orphans?: boolean;
  hasErrors?: boolean;
}

export interface ConfigCollection {
  name: string;
  files: string | string[];
  modes?: string[];
  modeDimension?: number;
  fileModes?: Record<string, string>;
}

export interface ProjectConfig {
  collections: ConfigCollection[];
  resolution: { crossCollection: boolean; order?: string[]; maxAliasDepth: number };
  writeDebounceMs: number;
  strictTypes: boolean;
  inferTypes: boolean;
}

/** Partial config patch sent to PATCH /api/config. */
export interface ConfigPatch {
  strictTypes?: boolean;
  inferTypes?: boolean;
  writeDebounceMs?: number;
  crossCollection?: boolean;
  maxAliasDepth?: number;
  order?: string[];
  collections?: {
    name: string;
    modes?: string[];
    fileModes?: Record<string, string>;
    modeDimension?: number | null;
  }[];
}

export interface QuickFix {
  label: string;
  action: string;
  data?: Record<string, unknown>;
}

// ---- Distribution (Phase 4 — token-config.json manifest) ----

export type ThemeModeKind = 'light' | 'dark' | 'merged' | 'both';

export interface ManifestOutput {
  useCssVariables: boolean;
  buildPath: string;
  exportPrefix: string;
}
export interface ManifestThemeMode {
  mode: ThemeModeKind;
  defaultTheme: string;
  lightSelector: string;
  darkSelector: string;
}
export interface ManifestTheme {
  name: string;
  primitiveFile: string;
  objectName?: string;
}
export interface ManifestTokenEntry {
  enabled: boolean;
  sourceFile?: string;
  sourcePath?: string;
  outputPath?: string;
  scssOutputPath?: string;
  generateTypescript?: boolean;
  generateScss?: boolean;
  generateInterface?: boolean;
  interfaceName?: string;
  useMediaQueries?: boolean;
}
export interface ManifestStructure {
  perTokenFile?: boolean;
  indexFile?: string;
  tempDirectory: string;
  sourceRoot?: string;
  presetOutputPath?: string;
}
export interface ManifestComments {
  fileHeader?: string;
}
export interface TokenConfigManifest {
  output: ManifestOutput;
  themeMode: ManifestThemeMode;
  themes: ManifestTheme[];
  tokens: Record<string, ManifestTokenEntry>;
  structure: ManifestStructure;
  comments: ManifestComments;
}
export interface DistributionCollection {
  name: string;
  files: string[];
  modes: string[];
}
export interface NpmScript {
  name: string;
  command: string;
}
export interface SdVersionInfo {
  installed: number | null;
  mode: 'v3' | 'v5' | 'none';
}
/** Pointer to an external build the project already owns ("I have my config"). */
export interface LinkedConfig {
  configPath: string;
  buildCommand: string;
}
export interface DistributionState {
  /** Stable id of the open project (its root) — scopes client-side drafts. */
  projectId: string;
  manifestPath: string | null;
  exists: boolean;
  manifest: TokenConfigManifest | null;
  collections: DistributionCollection[];
  modes: string[];
  hasBuildScript: boolean;
  buildScriptPath: string | null;
  npmScripts: NpmScript[];
  styleDictionaryAvailable: boolean;
  sdVersion: SdVersionInfo;
  /** Previously-saved v5 matrix (server sidecar), if any. */
  savedMatrix: DistMatrix | null;
  /** Relative path of a written v5 build script, if present. */
  v5ScriptPath: string | null;
  /** Pointer to an external build the project already owns ("I have my config"). */
  linked: LinkedConfig | null;
  /** Config-file candidates found at the project root (suggestions for linking). */
  detectedConfigs: string[];
  warnings: string[];
}
export interface WriteDistributionResult {
  ok: boolean;
  scriptPath: string;
  npmScript: NpmScript;
  npmAdded: boolean;
  /** Dependency specs (`name@range`) added to devDependencies (empty = none needed). */
  addedDependencies: string[];
  error?: string;
}

// ---- v5 matrix + test build (Phase 4 redesign) ----
/** A named variant of a source: `file` set = theme file; absent = mode segment. */
export interface MatrixVariant {
  name: string;
  file?: string;
}
export interface MatrixSource {
  id: string;
  label: string;
  files: string[];
  wrapUnder?: string;
  variants: MatrixVariant[];
}
export type RenderStrategy = 'selectors' | 'media' | 'files' | 'single';
export interface TargetRendering {
  strategy: RenderStrategy;
  /** variant name → value (CSS selector for `selectors`, media condition for `media`). */
  map?: Record<string, string>;
}
export interface MatrixTarget {
  id: string;
  label: string;
  format: string;
  destination: string;
  prefix?: string;
  sources: string[] | 'all';
  /** Per-source render strategy + mapping (keyed by source id). */
  rendering?: Record<string, TargetRendering>;
  options?: Record<string, unknown>;
}
export interface DistMatrix {
  sourceRoot: string;
  sources: MatrixSource[];
  targets: MatrixTarget[];
  tokensStudio?: boolean;
}
export interface BuildDiagnostic {
  level: 'error' | 'warn';
  message: string;
  target?: string;
  theme?: string;
  token?: string;
  reference?: string;
}
export interface DistBuildReport {
  ok: boolean;
  outputs: { target: string; file: string; bytes: number }[];
  diagnostics: BuildDiagnostic[];
  durationMs?: number;
  error?: string;
}

export type RealtimeEvent =
  | { type: 'tokens-changed'; affectedTokenIds: string[] }
  | { type: 'file-changed'; file: string }
  | { type: 'project-reloaded' }
  | { type: 'diagnostics-updated'; diagnostics: Diagnostic[] };
