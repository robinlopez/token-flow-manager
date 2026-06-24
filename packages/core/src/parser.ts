import jsonMap from 'json-source-map';
import {
  type Diagnostic,
  type DtcgType,
  type TokenPath,
  type TokenSource,
  isDtcgType,
  isDtcgToken,
  isReservedKey,
  inferType,
  makeDiagnostic,
  UNTYPED,
} from '@tokenflow/shared';

/** A token as extracted from a single file, before alias resolution. */
export interface RawToken {
  path: TokenPath;
  collection: string;
  group: string;
  /** DTCG type, inferred type, or the generic UNTYPED fallback. */
  type: string;
  /** Raw value per mode. Single-mode files use the `defaultMode` key. */
  rawValuesByMode: Record<string, unknown>;
  description?: string;
  deprecated?: boolean | string;
  extensions?: Record<string, unknown>;
  source: TokenSource;
}

export interface ParseFileResult {
  tokens: RawToken[];
  diagnostics: Diagnostic[];
}

export interface ParseFileOptions {
  file: string;
  collection: string;
  /** Modes declared for this collection. Empty → single implicit mode. */
  modes: string[];
  /** Mode key used when a token is not split by mode. */
  defaultMode: string;
  /** Emit errors for missing/unknown `$type`. Default false (tolerant). */
  strictTypes?: boolean;
  /** Infer a token's type from its value when `$type` is absent/unknown. Default true. */
  inferTypes?: boolean;
}

interface SourcePointer {
  value: { line: number; column: number; pos: number };
  valueEnd: { line: number; column: number; pos: number };
  key?: { line: number; column: number; pos: number };
  keyEnd?: { line: number; column: number; pos: number };
}

const MERGE_MARKERS = ['<<<<<<<', '=======', '>>>>>>>'];

/**
 * Parse a single DTCG JSON document into raw tokens + diagnostics.
 * Source positions are captured via json-source-map for precise error reporting.
 */
export function parseFile(content: string, opts: ParseFileOptions): ParseFileResult {
  const diagnostics: Diagnostic[] = [];

  // Passive merge-conflict detection — file is left read-only by callers.
  const conflictLine = findMergeConflict(content);
  if (conflictLine !== null) {
    diagnostics.push(
      makeDiagnostic('merge-conflict', 'error', 'File contains unresolved Git merge markers', {
        file: opts.file,
        line: conflictLine,
      }),
    );
    return { tokens: [], diagnostics };
  }

  let parsed: { data: unknown; pointers: Record<string, SourcePointer> };
  try {
    parsed = jsonMap.parse(content) as typeof parsed;
  } catch (err) {
    diagnostics.push(jsonErrorToDiagnostic(err, opts.file));
    return { tokens: [], diagnostics };
  }

  const root = parsed.data;
  if (typeof root !== 'object' || root === null || Array.isArray(root)) {
    diagnostics.push(
      makeDiagnostic('json-parse-error', 'error', 'Token document root must be a JSON object', {
        file: opts.file,
      }),
    );
    return { tokens: [], diagnostics };
  }

  const tokens: RawToken[] = [];
  walk(root as Record<string, unknown>, [], undefined, {
    opts,
    pointers: parsed.pointers,
    tokens,
    diagnostics,
  });

  return { tokens, diagnostics };
}

interface WalkCtx {
  opts: ParseFileOptions;
  pointers: Record<string, SourcePointer>;
  tokens: RawToken[];
  diagnostics: Diagnostic[];
}

function walk(
  node: Record<string, unknown>,
  path: TokenPath,
  inheritedType: DtcgType | undefined,
  ctx: WalkCtx,
): void {
  // A node's `$type` cascades to descendants (group default type).
  const declaredType = node['$type'];
  let groupType = inheritedType;
  if (typeof declaredType === 'string') {
    if (isDtcgType(declaredType)) {
      groupType = declaredType;
    } else if (ctx.opts.strictTypes) {
      ctx.diagnostics.push(
        makeDiagnostic('unknown-type', 'warning', `Unknown $type "${declaredType}"`, {
          file: ctx.opts.file,
          ...positionOf(ctx.pointers, path),
        }),
      );
    }
    // Tolerant mode: an unknown group $type (e.g. "design-token") is ignored,
    // so descendants fall back to inference rather than inheriting a bad type.
  }

  if (isDtcgToken(node)) {
    const token = buildToken(node, path, groupType, ctx);
    if (token) ctx.tokens.push(token);
    return;
  }

  for (const [key, child] of Object.entries(node)) {
    if (isReservedKey(key)) continue;
    if (typeof child === 'object' && child !== null && !Array.isArray(child)) {
      walk(child as Record<string, unknown>, [...path, key], groupType, ctx);
    }
  }
}

function buildToken(
  node: Record<string, unknown>,
  path: TokenPath,
  inheritedType: DtcgType | undefined,
  ctx: WalkCtx,
): RawToken | null {
  const source: TokenSource = { file: ctx.opts.file, ...positionOf(ctx.pointers, path) };

  const explicitType = node['$type'];
  let type: string | undefined = inheritedType;
  if (typeof explicitType === 'string' && isDtcgType(explicitType)) {
    type = explicitType;
  }

  const strict = ctx.opts.strictTypes ?? false;
  const infer = ctx.opts.inferTypes ?? true;

  if (!type && infer) {
    type = inferType(node['$value']);
  }

  if (!type) {
    if (strict) {
      ctx.diagnostics.push(
        makeDiagnostic(
          'missing-type',
          'error',
          `Token "${path.join('.')}" has no $type and inherits none`,
          { file: ctx.opts.file, line: source.line, column: source.column },
        ),
      );
      return null;
    }
    // Tolerant: keep the token with a generic type rather than dropping it.
    type = UNTYPED;
  }

  const rawValuesByMode = splitByMode(node['$value'], type, ctx.opts);

  return {
    path,
    collection: ctx.opts.collection,
    group: path[0] ?? '',
    type,
    rawValuesByMode,
    description: typeof node['$description'] === 'string' ? node['$description'] : undefined,
    deprecated:
      typeof node['$deprecated'] === 'boolean' || typeof node['$deprecated'] === 'string'
        ? (node['$deprecated'] as boolean | string)
        : undefined,
    extensions:
      typeof node['$extensions'] === 'object' && node['$extensions'] !== null
        ? (node['$extensions'] as Record<string, unknown>)
        : undefined,
    source,
  };
}

/**
 * Determine the per-mode raw values for a token.
 *
 * Strategy C (inline modes): if the collection declares modes and `$value` is a
 * plain object whose keys are all declared modes, each key is a mode value.
 * Otherwise the value applies to every declared mode (or the default mode).
 */
function splitByMode(
  value: unknown,
  _type: string,
  opts: ParseFileOptions,
): Record<string, unknown> {
  const modes = opts.modes.length > 0 ? opts.modes : [opts.defaultMode];

  if (opts.modes.length > 0 && isInlineModeValue(value, opts.modes)) {
    const out: Record<string, unknown> = {};
    for (const mode of modes) {
      out[mode] = (value as Record<string, unknown>)[mode];
    }
    return out;
  }

  const out: Record<string, unknown> = {};
  for (const mode of modes) out[mode] = value;
  return out;
}

function isInlineModeValue(value: unknown, modes: string[]): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value as Record<string, unknown>);
  if (keys.length === 0) return false;
  return keys.every((k) => modes.includes(k));
}

function positionOf(
  pointers: Record<string, SourcePointer>,
  path: TokenPath,
): { line: number; column: number } {
  const pointer = '/' + path.map(encodeJsonPointerSegment).join('/');
  const p = pointers[pointer];
  if (p?.key) return { line: p.key.line, column: p.key.column };
  if (p?.value) return { line: p.value.line, column: p.value.column };
  return { line: 0, column: 0 };
}

function encodeJsonPointerSegment(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1');
}

function findMergeConflict(content: string): number | null {
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (MERGE_MARKERS.some((m) => line.startsWith(m))) return i;
  }
  return null;
}

function jsonErrorToDiagnostic(err: unknown, file: string): Diagnostic {
  // json-source-map throws SyntaxError-like errors with dataPath / line info.
  const anyErr = err as { message?: string; line?: number; column?: number };
  return makeDiagnostic('json-parse-error', 'error', anyErr.message ?? 'Invalid JSON', {
    file,
    line: typeof anyErr.line === 'number' ? anyErr.line : undefined,
    column: typeof anyErr.column === 'number' ? anyErr.column : undefined,
  });
}
